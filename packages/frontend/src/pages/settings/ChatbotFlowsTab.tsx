import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Play,
  Pause,
  X,
} from 'lucide-react';
import { Button, Card, Input, Textarea, Select, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlowStep {
  id?: string;
  stepOrder: number;
  type:
    | 'send_message'
    | 'ask_question'
    | 'buttons'
    | 'condition'
    | 'assign_agent'
    | 'add_tag'
    | 'close_conversation';
  message?: string | null;
  options?: Record<string, unknown> | null;
  nextStepId?: string | null;
}

interface ChatbotFlow {
  id: string;
  botId: string;
  name: string;
  description?: string | null;
  status: 'active' | 'inactive' | 'draft';
  triggerOnNewConversation: boolean;
  steps?: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

interface TelegramBot {
  id: string;
  botId: string;
  botUsername: string;
  botFirstName: string;
  status: 'active' | 'inactive' | 'error';
}

const STEP_TYPES: { value: FlowStep['type']; label: string }[] = [
  { value: 'send_message', label: 'Send Message' },
  { value: 'ask_question', label: 'Ask Question' },
  { value: 'buttons', label: 'Show Buttons' },
  { value: 'assign_agent', label: 'Assign Agent' },
  { value: 'add_tag', label: 'Add Tag' },
  { value: 'close_conversation', label: 'Close Conversation' },
];

const STATUS_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  active: 'success',
  inactive: 'default',
  draft: 'default',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatbotFlowsTab() {
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [flows, setFlows] = useState<ChatbotFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editor state
  const [editing, setEditing] = useState<ChatbotFlow | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Editor form fields
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBotId, setFormBotId] = useState('');
  const [formTrigger, setFormTrigger] = useState(false);
  const [formStatus, setFormStatus] = useState<'active' | 'inactive' | 'draft'>('draft');
  const [formSteps, setFormSteps] = useState<FlowStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Expand/collapse step editor
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [botsData, flowsData] = await Promise.all([
        api<{ entries: TelegramBot[] }>('/telegram/bots'),
        api<{ entries: ChatbotFlow[] }>('/chatbot-flows'),
      ]);
      setBots(botsData.entries);
      setFlows(flowsData.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openNewFlow() {
    setEditing(null);
    setIsNew(true);
    setFormName('');
    setFormDescription('');
    setFormBotId(bots[0]?.id ?? '');
    setFormTrigger(false);
    setFormStatus('draft');
    setFormSteps([
      { stepOrder: 0, type: 'send_message', message: 'Hello! How can I help you today?' },
    ]);
    setExpandedStep(0);
    setFormError('');
  }

  async function openEditFlow(id: string) {
    setFormError('');
    try {
      const flow = await api<ChatbotFlow>(`/chatbot-flows/${id}`);
      setEditing(flow);
      setIsNew(false);
      setFormName(flow.name);
      setFormDescription(flow.description ?? '');
      setFormBotId(flow.botId);
      setFormTrigger(flow.triggerOnNewConversation);
      setFormStatus(flow.status);
      setFormSteps(
        flow.steps?.map((s, i) => ({ ...s, stepOrder: i })) ?? [],
      );
      setExpandedStep(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load flow');
    }
  }

  function closeEditor() {
    setEditing(null);
    setIsNew(false);
  }

  function addStep() {
    const newStep: FlowStep = {
      stepOrder: formSteps.length,
      type: 'send_message',
      message: '',
    };
    setFormSteps([...formSteps, newStep]);
    setExpandedStep(formSteps.length);
  }

  function removeStep(index: number) {
    const updated = formSteps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepOrder: i }));
    setFormSteps(updated);
    setExpandedStep(null);
  }

  function updateStep(index: number, patch: Partial<FlowStep>) {
    const updated = [...formSteps];
    updated[index] = { ...updated[index], ...patch };
    setFormSteps(updated);
  }

  function moveStep(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= formSteps.length) return;
    const updated = [...formSteps];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    updated.forEach((s, i) => (s.stepOrder = i));
    setFormSteps(updated);
    setExpandedStep(newIndex);
  }

  async function handleSave() {
    if (!formName.trim()) {
      setFormError('Flow name is required');
      return;
    }
    if (!formBotId) {
      setFormError('Please select a bot');
      return;
    }

    setSaving(true);
    setFormError('');
    setSuccess('');

    try {
      const body = {
        botId: formBotId,
        name: formName.trim(),
        description: formDescription.trim() || null,
        status: formStatus,
        triggerOnNewConversation: formTrigger,
        steps: formSteps.map((s, i) => ({
          stepOrder: i,
          type: s.type,
          message: s.message || null,
          options: s.options || null,
          nextStepId: s.nextStepId || null,
        })),
      };

      if (isNew) {
        await api('/chatbot-flows', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setSuccess('Flow created successfully');
      } else if (editing) {
        await api(`/chatbot-flows/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setSuccess('Flow updated successfully');
      }

      closeEditor();
      await fetchData();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save flow');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/chatbot-flows/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Flow deleted successfully');
      setFlows((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete flow');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleToggleStatus(flow: ChatbotFlow) {
    const newStatus = flow.status === 'active' ? 'inactive' : 'active';
    try {
      await api(`/chatbot-flows/${flow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      setSuccess(`Flow ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      await fetchData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update flow');
    }
  }

  // ---------------------------------------------------------------------------
  // Step editor helpers
  // ---------------------------------------------------------------------------

  function renderButtonsEditor(step: FlowStep, index: number) {
    const opts = (step.options as { buttons?: { text: string; value: string }[] }) ?? {};
    const buttons = opts.buttons ?? [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label className={styles.toggleLabel}>Buttons</label>
        {buttons.map((btn, bi) => (
          <div key={bi} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              placeholder="Button text"
              value={btn.text}
              onChange={(e) => {
                const updated = [...buttons];
                updated[bi] = { ...updated[bi], text: e.target.value };
                updateStep(index, { options: { buttons: updated } });
              }}
            />
            <Input
              placeholder="Callback value"
              value={btn.value}
              onChange={(e) => {
                const updated = [...buttons];
                updated[bi] = { ...updated[bi], value: e.target.value };
                updateStep(index, { options: { buttons: updated } });
              }}
            />
            <button
              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
              onClick={() => {
                const updated = buttons.filter((_, i) => i !== bi);
                updateStep(index, { options: { buttons: updated } });
              }}
              title="Remove button"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const updated = [...buttons, { text: '', value: '' }];
            updateStep(index, { options: { buttons: updated } });
          }}
        >
          Add Button
        </Button>
      </div>
    );
  }

  function renderStepConfig(step: FlowStep, index: number) {
    switch (step.type) {
      case 'send_message':
      case 'close_conversation':
        return (
          <Textarea
            label="Message"
            placeholder="Enter the message to send..."
            value={step.message ?? ''}
            onChange={(e) => updateStep(index, { message: e.target.value })}
            rows={3}
          />
        );
      case 'ask_question':
        return (
          <>
            <Textarea
              label="Question"
              placeholder="What question should the bot ask?"
              value={step.message ?? ''}
              onChange={(e) => updateStep(index, { message: e.target.value })}
              rows={2}
            />
            <Input
              label="Store answer as field"
              placeholder="e.g. email, phone, name"
              value={(step.options as { field?: string })?.field ?? ''}
              onChange={(e) =>
                updateStep(index, { options: { ...(step.options ?? {}), field: e.target.value } })
              }
            />
          </>
        );
      case 'buttons':
        return (
          <>
            <Textarea
              label="Message (shown above buttons)"
              placeholder="Please choose an option:"
              value={step.message ?? ''}
              onChange={(e) => updateStep(index, { message: e.target.value })}
              rows={2}
            />
            {renderButtonsEditor(step, index)}
          </>
        );
      case 'assign_agent':
        return (
          <Input
            label="Agent ID (leave empty for round-robin)"
            placeholder="Agent UUID"
            value={(step.options as { agentId?: string })?.agentId ?? ''}
            onChange={(e) =>
              updateStep(index, { options: { agentId: e.target.value || undefined } })
            }
          />
        );
      case 'add_tag':
        return (
          <Input
            label="Tag"
            placeholder="Enter tag name"
            value={(step.options as { tag?: string })?.tag ?? ''}
            onChange={(e) => updateStep(index, { options: { tag: e.target.value } })}
          />
        );
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const showEditor = isNew || editing;

  if (showEditor) {
    return (
      <div>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>{isNew ? 'Create Flow' : 'Edit Flow'}</h2>
              <p className={styles.sectionDescription}>
                Configure a multi-step chatbot conversation.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={closeEditor}>
              Cancel
            </Button>
          </div>

          {formError && <div className={styles.alert}>{formError}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
            <Input
              label="Flow Name"
              placeholder="e.g. Lead Qualification"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <Textarea
              label="Description (optional)"
              placeholder="What does this flow do?"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={2}
            />
            <Select
              label="Bot"
              value={formBotId}
              onChange={(e) => setFormBotId(e.target.value)}
            >
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.botFirstName} (@{bot.botUsername})
                </option>
              ))}
            </Select>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <Select
                label="Status"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as 'active' | 'inactive' | 'draft')}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    className={styles.toggleInput}
                    checked={formTrigger}
                    onChange={(e) => setFormTrigger(e.target.checked)}
                  />
                  <span className={styles.toggleSlider} />
                </label>
                <span className={styles.toggleLabel}>Trigger on new conversation</span>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Steps</h2>
            <Button size="sm" variant="secondary" onClick={addStep}>
              <Plus size={14} style={{ marginRight: 4 }} />
              Add Step
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {formSteps.map((step, index) => (
              <div key={index} className={styles.botCard} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                  onClick={() => setExpandedStep(expandedStep === index ? null : index)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <GripVertical size={14} color="var(--color-text-tertiary)" />
                    <span style={{ fontWeight: 500, fontSize: 14 }}>
                      {index + 1}. {STEP_TYPES.find((t) => t.value === step.type)?.label ?? step.type}
                    </span>
                    {step.message && (
                      <span
                        style={{
                          fontSize: 13,
                          color: 'var(--color-text-tertiary)',
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        — {step.message}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      className={styles.iconBtn}
                      onClick={(e) => { e.stopPropagation(); moveStep(index, -1); }}
                      disabled={index === 0}
                      title="Move up"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={(e) => { e.stopPropagation(); moveStep(index, 1); }}
                      disabled={index === formSteps.length - 1}
                      title="Move down"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={(e) => { e.stopPropagation(); removeStep(index); }}
                      title="Remove step"
                    >
                      <Trash2 size={14} />
                    </button>
                    {expandedStep === index ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </div>

                {expandedStep === index && (
                  <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Select
                      label="Step Type"
                      value={step.type}
                      onChange={(e) => updateStep(index, { type: e.target.value as FlowStep['type'], options: null })}
                    >
                      {STEP_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                    {renderStepConfig(step, index)}
                  </div>
                )}
              </div>
            ))}

            {formSteps.length === 0 && (
              <Card>
                <div className={styles.emptyState} style={{ padding: '24px 16px' }}>
                  <p>No steps yet. Add a step to build your chatbot flow.</p>
                </div>
              </Card>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', paddingTop: 8 }}>
          <Button variant="secondary" onClick={closeEditor} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isNew ? 'Create Flow' : 'Save Changes'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Chatbot Flows</h2>
            <p className={styles.sectionDescription}>
              Create scripted multi-step conversations to collect lead info and qualify prospects.
            </p>
          </div>
          <Button size="sm" onClick={openNewFlow} disabled={bots.length === 0}>
            <Plus size={14} style={{ marginRight: 4 }} />
            New Flow
          </Button>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.loadingState}>Loading flows...</div>
        ) : bots.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>Connect a Telegram bot first to create chatbot flows.</p>
            </div>
          </Card>
        ) : flows.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>No chatbot flows yet.</p>
              <p>Create a flow to automate conversations with your Telegram contacts.</p>
            </div>
          </Card>
        ) : (
          <div className={styles.botList}>
            {flows.map((flow) => {
              const bot = bots.find((b) => b.id === flow.botId);
              return (
                <div key={flow.id} className={styles.botCard}>
                  <div className={styles.botInfo}>
                    <div className={styles.botName}>
                      {flow.name}
                      <Badge color={STATUS_COLOR[flow.status]}>{flow.status}</Badge>
                      {flow.triggerOnNewConversation && (
                        <Badge color="default">auto-trigger</Badge>
                      )}
                    </div>
                    {flow.description && (
                      <div className={styles.botUsername}>{flow.description}</div>
                    )}
                    <div className={styles.botMeta}>
                      Bot: {bot ? `@${bot.botUsername}` : 'unknown'} &middot; Updated{' '}
                      {new Date(flow.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className={styles.botActions}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => handleToggleStatus(flow)}
                      title={flow.status === 'active' ? 'Deactivate' : 'Activate'}
                    >
                      {flow.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openEditFlow(flow.id)}
                      title="Edit flow"
                    >
                      <Pencil size={16} />
                    </button>
                    {deletingId === flow.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setDeletingId(null)}
                          disabled={deleteLoading}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleDelete(flow.id)}
                          disabled={deleteLoading}
                        >
                          {deleteLoading ? 'Deleting...' : 'Confirm'}
                        </Button>
                      </>
                    ) : (
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => setDeletingId(flow.id)}
                        title="Delete flow"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
