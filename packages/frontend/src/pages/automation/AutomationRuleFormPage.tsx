import { type FormEvent, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Check } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Input, Select, Textarea } from '../../ui';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/error-messages';
import styles from './AutomationRuleFormPage.module.css';

type AutomationTrigger =
  | 'contact_created'
  | 'deal_created'
  | 'deal_stage_changed'
  | 'message_received'
  | 'tag_added'
  | 'task_completed'
  | 'conversation_created';

type AutomationAction =
  | 'assign_agent'
  | 'create_task'
  | 'send_message'
  | 'move_deal'
  | 'add_tag'
  | 'send_notification'
  | 'create_deal';

type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in';

interface Condition {
  field: string;
  operator: ConditionOperator;
  value: string;
}

interface AutomationRuleData {
  id: string;
  name: string;
  description?: string | null;
  trigger: AutomationTrigger;
  conditions: Condition[];
  action: AutomationAction;
  actionParams: Record<string, unknown>;
  isActive: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface UserOption {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

interface PipelineOption {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

const TRIGGERS: { value: AutomationTrigger; label: string }[] = [
  { value: 'contact_created', label: 'Contact Created' },
  { value: 'deal_created', label: 'Deal Created' },
  { value: 'deal_stage_changed', label: 'Deal Stage Changed' },
  { value: 'message_received', label: 'Message Received' },
  { value: 'tag_added', label: 'Tag Added' },
  { value: 'task_completed', label: 'Task Completed' },
  { value: 'conversation_created', label: 'Conversation Created' },
];

const ACTIONS: { value: AutomationAction; label: string }[] = [
  { value: 'assign_agent', label: 'Assign Agent' },
  { value: 'create_task', label: 'Create Task' },
  { value: 'send_message', label: 'Send Message' },
  { value: 'move_deal', label: 'Move Deal' },
  { value: 'add_tag', label: 'Add Tag' },
  { value: 'send_notification', label: 'Send Notification' },
  { value: 'create_deal', label: 'Create Deal' },
];

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Not Equals' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'Greater or Equal' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'Less or Equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Not Contains' },
  { value: 'in', label: 'In List' },
  { value: 'not_in', label: 'Not In List' },
];

const TRIGGER_FIELDS: Record<AutomationTrigger, { value: string; label: string }[]> = {
  contact_created: [
    { value: 'contact.source', label: 'Source' },
    { value: 'contact.tagNames', label: 'Contact Tags' },
    { value: 'contact.email', label: 'Email' },
  ],
  deal_created: [
    { value: 'deal.value', label: 'Deal Value' },
    { value: 'deal.pipelineId', label: 'Pipeline' },
    { value: 'deal.stageId', label: 'Stage' },
  ],
  deal_stage_changed: [
    { value: 'previousStageId', label: 'From Stage' },
    { value: 'newStageId', label: 'To Stage' },
    { value: 'deal.pipelineId', label: 'Pipeline' },
  ],
  message_received: [
    { value: 'conversation.channelType', label: 'Channel' },
    { value: 'message.content', label: 'Message Content' },
    { value: 'contact.tagNames', label: 'Contact Tags' },
    { value: 'contact.source', label: 'Contact Source' },
  ],
  tag_added: [
    { value: 'tag', label: 'Tag Name' },
    { value: 'entityType', label: 'Entity Type' },
  ],
  task_completed: [
    { value: 'task.type', label: 'Task Type' },
    { value: 'task.priority', label: 'Priority' },
  ],
  conversation_created: [
    { value: 'conversation.channelType', label: 'Channel' },
    { value: 'contact.source', label: 'Contact Source' },
    { value: 'contact.tagNames', label: 'Contact Tags' },
  ],
};

export function AutomationRuleFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState<AutomationTrigger>('contact_created');
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [action, setAction] = useState<AutomationAction>('assign_agent');
  const [actionParams, setActionParams] = useState<Record<string, string>>({});
  const [isActive, setIsActive] = useState(true);
  const [priority, setPriority] = useState('0');

  const [users, setUsers] = useState<UserOption[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [roundRobinAgentIds, setRoundRobinAgentIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);

  useEffect(() => {
    async function fetchOptions() {
      try {
        const [usersRes, pipelinesRes] = await Promise.all([
          api<{ entries: UserOption[] }>('/users?limit=200').catch(() => ({ entries: [] })),
          api<{ entries: PipelineOption[] }>('/pipelines?limit=200').catch(() => ({ entries: [] })),
        ]);
        setUsers(usersRes.entries);
        setPipelines(pipelinesRes.entries);
      } catch {
        // Options are non-critical
      }
    }
    fetchOptions();
  }, []);

  useEffect(() => {
    if (!id) return;

    async function fetchRule() {
      setFetching(true);
      try {
        const data = await api<AutomationRuleData>(`/automation-rules/${id}`);
        setName(data.name);
        setDescription(data.description || '');
        setTrigger(data.trigger);
        setConditions(
          (data.conditions || []).map((c) => ({
            field: c.field || '',
            operator: c.operator || 'eq',
            value: typeof c.value === 'string' ? c.value : JSON.stringify(c.value ?? ''),
          })),
        );
        setAction(data.action);
        const ap = data.actionParams || {};
        setActionParams(
          Object.fromEntries(
            Object.entries(ap)
              .filter(([k]) => k !== 'agentIds')
              .map(([k, v]) => [
                k,
                typeof v === 'string' ? v : JSON.stringify(v ?? ''),
              ]),
          ),
        );
        if (Array.isArray(ap.agentIds)) {
          setRoundRobinAgentIds(ap.agentIds as string[]);
        }
        setIsActive(data.isActive);
        setPriority(String(data.priority));
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setFetching(false);
      }
    }

    fetchRule();
  }, [id]);

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors.name = 'Name is required';
    } else if (name.length > 255) {
      errors.name = 'Name must be 255 characters or less';
    }

    const p = parseInt(priority, 10);
    if (isNaN(p) || p < 0) {
      errors.priority = 'Priority must be 0 or greater';
    }

    for (let i = 0; i < conditions.length; i++) {
      if (!conditions[i].field) {
        errors[`condition_${i}_field`] = 'Field is required';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function addCondition() {
    const fields = TRIGGER_FIELDS[trigger];
    setConditions((prev) => [
      ...prev,
      { field: fields[0]?.value || '', operator: 'eq', value: '' },
    ]);
  }

  function removeCondition(index: number) {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCondition(index: number, updates: Partial<Condition>) {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    );
  }

  function setActionParam(key: string, value: string) {
    setActionParams((prev) => ({ ...prev, [key]: value }));
  }

  function handleTriggerChange(newTrigger: AutomationTrigger) {
    setTrigger(newTrigger);
    setConditions([]);
  }

  function handleActionChange(newAction: AutomationAction) {
    setAction(newAction);
    setActionParams({});
    setRoundRobinAgentIds([]);
  }

  function toggleRoundRobinAgent(agentId: string) {
    setRoundRobinAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        trigger,
        action,
        isActive,
        priority: parseInt(priority, 10),
      };

      if (description.trim()) body.description = description.trim();
      else if (isEdit) body.description = null;

      if (conditions.length > 0) {
        body.conditions = conditions.map((c) => ({
          field: c.field,
          operator: c.operator,
          value: c.value,
        }));
      } else {
        body.conditions = [];
      }

      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(actionParams)) {
        if (v) params[k] = v;
      }
      if (action === 'assign_agent' && params.mode === 'round_robin') {
        params.agentIds = roundRobinAgentIds;
      }
      body.actionParams = params;

      if (isEdit) {
        await api(`/automation-rules/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        navigate('/automation', { replace: true });
      } else {
        await api('/automation-rules', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        navigate('/automation', { replace: true });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <div>
        <PageHeader title={isEdit ? 'Edit Rule' : 'New Automation Rule'} />
        <div className={styles.loadingState}>Loading rule...</div>
      </div>
    );
  }

  const triggerFields = TRIGGER_FIELDS[trigger] || [];
  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Rule' : 'New Automation Rule'}
        description={isEdit ? 'Update automation rule configuration' : 'Set up a new automation rule'}
      />

      <div className={styles.backLink}>
        <Link to="/automation" className={styles.back}>
          <ArrowLeft size={14} />
          All Rules
        </Link>
      </div>

      <Card className={styles.formCard}>
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <div className={styles.alert}>{error}</div>}

          {/* Basic Details */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Rule Details</h3>
            <Input
              label="Name"
              placeholder="e.g. Auto-assign new leads"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={fieldErrors.name}
              required
              autoFocus
            />
            <Textarea
              label="Description"
              placeholder="What does this rule do..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
            <div className={styles.row}>
              <Input
                label="Priority"
                type="number"
                min="0"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                error={fieldErrors.priority}
              />
              <div className={styles.toggleRow}>
                <button
                  type="button"
                  className={`${styles.toggle} ${isActive ? styles.toggleOn : styles.toggleOff}`}
                  onClick={() => setIsActive(!isActive)}
                >
                  <div className={styles.toggleKnob} />
                </button>
                <span className={styles.toggleLabel}>
                  {isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          {/* Trigger */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Trigger</h3>
            <Select
              label="When this happens..."
              value={trigger}
              onChange={(e) => handleTriggerChange(e.target.value as AutomationTrigger)}
            >
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Conditions */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Conditions</h3>
            {conditions.length === 0 && (
              <p className={styles.noConditions}>
                No conditions — rule will fire on every trigger event.
              </p>
            )}
            <div className={styles.conditionsList}>
              {conditions.map((condition, index) => (
                <div key={index} className={styles.conditionRow}>
                  <Select
                    label={index === 0 ? 'Field' : undefined}
                    value={condition.field}
                    onChange={(e) => updateCondition(index, { field: e.target.value })}
                    error={fieldErrors[`condition_${index}_field`]}
                  >
                    <option value="">Select field...</option>
                    {triggerFields.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label={index === 0 ? 'Operator' : undefined}
                    value={condition.operator}
                    onChange={(e) =>
                      updateCondition(index, { operator: e.target.value as ConditionOperator })
                    }
                  >
                    {OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label={index === 0 ? 'Value' : undefined}
                    placeholder="Value"
                    value={condition.value}
                    onChange={(e) => updateCondition(index, { value: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => removeCondition(index)}
                    title="Remove condition"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div>
              <button type="button" className={styles.addConditionBtn} onClick={addCondition}>
                <Plus size={14} />
                Add Condition
              </button>
            </div>
          </div>

          {/* Action */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Action</h3>
            <Select
              label="Then do this..."
              value={action}
              onChange={(e) => handleActionChange(e.target.value as AutomationAction)}
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>

            {/* Action-specific parameters */}
            {action === 'assign_agent' && (
              <>
                <Select
                  label="Assignment Mode"
                  value={actionParams.mode || 'specific'}
                  onChange={(e) => {
                    setActionParam('mode', e.target.value);
                    if (e.target.value === 'round_robin') {
                      setActionParam('agentId', '');
                    } else {
                      setRoundRobinAgentIds([]);
                    }
                  }}
                >
                  <option value="specific">Specific Agent</option>
                  <option value="round_robin">Round-Robin</option>
                </Select>

                {(actionParams.mode || 'specific') === 'specific' && (
                  <Select
                    label="Assign to"
                    value={actionParams.agentId || ''}
                    onChange={(e) => setActionParam('agentId', e.target.value)}
                  >
                    <option value="">Select agent...</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                      </option>
                    ))}
                  </Select>
                )}

                {actionParams.mode === 'round_robin' && (
                  <div>
                    <label className={styles.fieldLabel}>
                      Agent Pool {roundRobinAgentIds.length > 0 && `(${roundRobinAgentIds.length} selected)`}
                    </label>
                    <p className={styles.fieldHint}>
                      Select agents to rotate between. Leave empty to include all active users.
                    </p>
                    <div className={styles.agentPool}>
                      {users.map((u) => {
                        const selected = roundRobinAgentIds.includes(u.id);
                        const displayName =
                          [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
                        return (
                          <button
                            key={u.id}
                            type="button"
                            className={`${styles.agentChip} ${selected ? styles.agentChipSelected : ''}`}
                            onClick={() => toggleRoundRobinAgent(u.id)}
                          >
                            {selected && <Check size={12} />}
                            {displayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {action === 'create_task' && (
              <>
                <Input
                  label="Task Title"
                  placeholder="e.g. Follow up with new contact"
                  value={actionParams.title || ''}
                  onChange={(e) => setActionParam('title', e.target.value)}
                />
                <div className={styles.row}>
                  <Select
                    label="Task Type"
                    value={actionParams.type || 'follow_up'}
                    onChange={(e) => setActionParam('type', e.target.value)}
                  >
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                    <option value="email">Email</option>
                    <option value="follow_up">Follow Up</option>
                    <option value="other">Other</option>
                  </Select>
                  <Select
                    label="Priority"
                    value={actionParams.taskPriority || 'medium'}
                    onChange={(e) => setActionParam('taskPriority', e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </div>
                <Select
                  label="Assign to"
                  value={actionParams.assigneeId || ''}
                  onChange={(e) => setActionParam('assigneeId', e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                    </option>
                  ))}
                </Select>
              </>
            )}

            {action === 'send_message' && (
              <Textarea
                label="Message Text"
                placeholder="Enter the message to send..."
                value={actionParams.message || ''}
                onChange={(e) => setActionParam('message', e.target.value)}
                rows={3}
              />
            )}

            {action === 'move_deal' && (
              <>
                <div className={styles.row}>
                  <Select
                    label="Pipeline"
                    value={actionParams.pipelineId || ''}
                    onChange={(e) => {
                      setActionParam('pipelineId', e.target.value);
                      setActionParam('pipelineStageId', '');
                    }}
                  >
                    <option value="">Select pipeline...</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Move to Stage"
                    value={actionParams.pipelineStageId || ''}
                    onChange={(e) => setActionParam('pipelineStageId', e.target.value)}
                  >
                    <option value="">Select stage...</option>
                    {(actionParams.pipelineId
                      ? pipelines.find((p) => p.id === actionParams.pipelineId)?.stages || []
                      : pipelines.flatMap((p) => p.stages)
                    ).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input
                  label="Lost Reason (optional)"
                  placeholder="Reason if moving to a loss stage"
                  value={actionParams.lostReason || ''}
                  onChange={(e) => setActionParam('lostReason', e.target.value)}
                />
              </>
            )}

            {action === 'add_tag' && (
              <Input
                label="Tag Name"
                placeholder="e.g. hot-lead"
                value={actionParams.tag || ''}
                onChange={(e) => setActionParam('tag', e.target.value)}
              />
            )}

            {action === 'send_notification' && (
              <>
                <Input
                  label="Notification Title"
                  placeholder="e.g. New lead assigned"
                  value={actionParams.title || ''}
                  onChange={(e) => setActionParam('title', e.target.value)}
                />
                <Textarea
                  label="Notification Message"
                  placeholder="Enter notification content..."
                  value={actionParams.message || ''}
                  onChange={(e) => setActionParam('message', e.target.value)}
                  rows={2}
                />
                <Select
                  label="Notify"
                  value={actionParams.recipientId || ''}
                  onChange={(e) => setActionParam('recipientId', e.target.value)}
                >
                  <option value="">Select recipient...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                    </option>
                  ))}
                </Select>
              </>
            )}

            {action === 'create_deal' && (
              <>
                <Input
                  label="Deal Title"
                  placeholder="e.g. Telegram Lead"
                  value={actionParams.title || ''}
                  onChange={(e) => setActionParam('title', e.target.value)}
                />
                <div className={styles.row}>
                  <Select
                    label="Pipeline"
                    value={actionParams.pipelineId || ''}
                    onChange={(e) => {
                      setActionParam('pipelineId', e.target.value);
                      setActionParam('pipelineStageId', '');
                    }}
                  >
                    <option value="">Default pipeline</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Stage"
                    value={actionParams.pipelineStageId || ''}
                    onChange={(e) => setActionParam('pipelineStageId', e.target.value)}
                  >
                    <option value="">First stage</option>
                    {(actionParams.pipelineId
                      ? pipelines.find((p) => p.id === actionParams.pipelineId)?.stages || []
                      : pipelines.flatMap((p) => p.stages)
                    ).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className={styles.row}>
                  <Input
                    label="Deal Value"
                    placeholder="e.g. 1000"
                    type="number"
                    value={actionParams.value || ''}
                    onChange={(e) => setActionParam('value', e.target.value)}
                  />
                  <Input
                    label="Currency"
                    placeholder="USD"
                    value={actionParams.currency || ''}
                    onChange={(e) => setActionParam('currency', e.target.value)}
                  />
                </div>
                <Select
                  label="Assign to"
                  value={actionParams.ownerId || ''}
                  onChange={(e) => setActionParam('ownerId', e.target.value)}
                >
                  <option value="">Contact owner</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                    </option>
                  ))}
                </Select>
                <Textarea
                  label="Notes"
                  placeholder="Deal notes..."
                  value={actionParams.notes || ''}
                  onChange={(e) => setActionParam('notes', e.target.value)}
                  rows={2}
                />
              </>
            )}
          </div>

          <div className={styles.formActions}>
            <Link to="/automation">
              <Button type="button" variant="secondary" size="md">
                Cancel
              </Button>
            </Link>
            <Button type="submit" size="md" disabled={loading}>
              {loading
                ? isEdit
                  ? 'Saving...'
                  : 'Creating...'
                : isEdit
                  ? 'Save Changes'
                  : 'Create Rule'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
