import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X } from 'lucide-react';
import { Button, Card, Input, Textarea, Badge, Select } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

interface KBEntry {
  id: string;
  title: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface KBResponse {
  total: number;
  limit: number;
  offset: number;
  entries: KBEntry[];
}

interface AIStatus {
  configured: boolean;
  provider: AIProvider;
  model: string;
}

type AIProvider = 'openai' | 'openrouter';

interface AISettings {
  provider: AIProvider;
  model: string;
}

interface KBFormData {
  title: string;
  content: string;
}

const EMPTY_FORM: KBFormData = {
  title: '',
  content: '',
};

const CUSTOM_MODEL_VALUE = '__custom_model__';

const MODEL_OPTIONS: Record<AIProvider, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-5-nano', label: 'gpt-5-nano' },
    { value: 'gpt-5-pro', label: 'gpt-5-pro' },
  ],
  openrouter: [
    { value: 'openai/gpt-5.2', label: 'openai/gpt-5.2' },
    { value: 'openai/gpt-5.2-chat', label: 'openai/gpt-5.2-chat' },
    { value: 'openai/gpt-5.2-pro', label: 'openai/gpt-5.2-pro' },
    { value: 'anthropic/claude-sonnet-4.6', label: 'anthropic/claude-sonnet-4.6' },
    { value: 'anthropic/claude-opus-4.6', label: 'anthropic/claude-opus-4.6' },
    { value: 'google/gemini-3.1-pro-preview', label: 'google/gemini-3.1-pro-preview' },
    { value: 'google/gemini-3-flash-preview', label: 'google/gemini-3-flash-preview' },
    { value: 'minimax/minimax-m2.5', label: 'minimax/minimax-m2.5' },
    { value: 'moonshotai/kimi-k2.5', label: 'moonshotai/kimi-k2.5' },
    { value: 'z-ai/glm-5', label: 'z-ai/glm-5' },
  ],
};

function providerLabel(provider: AIProvider): string {
  return provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
}

export function AIKnowledgeBaseTab() {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // AI status
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>({
    provider: 'openai',
    model: 'gpt-4o-mini',
  });
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState('');
  const [configSuccess, setConfigSuccess] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<KBFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (search) params.set('search', search);

      const data = await api<KBResponse>(`/knowledge-base?${params}`);
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load knowledge base entries');
      }
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const fetchAIConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError('');

    try {
      const [status, settings] = await Promise.all([
        api<AIStatus>('/ai/status'),
        api<AISettings>('/ai/settings'),
      ]);

      setAiStatus(status);
      setAiSettings(settings);
      const modelInPreset = MODEL_OPTIONS[settings.provider].some((m) => m.value === settings.model);
      setUseCustomModel(!modelInPreset);
      setCustomModel(modelInPreset ? '' : settings.model);
    } catch (err) {
      setAiStatus(null);
      if (err instanceof ApiError) {
        setConfigError(err.message);
      } else {
        setConfigError('Failed to load AI configuration');
      }
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAIConfig();
  }, [fetchAIConfig]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(entry: KBEntry) {
    setEditingId(entry.id);
    setForm({
      title: entry.title,
      content: entry.content,
    });
    setFormErrors({});
    setFormError('');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormError('');
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!form.title.trim()) errors.title = 'Title is required';
    else if (form.title.length > 255) errors.title = 'Title must be 255 characters or less';
    if (!form.content.trim()) errors.content = 'Content is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    setFormError('');
    setSuccess('');
    try {
      const body = {
        title: form.title.trim(),
        content: form.content.trim(),
      };

      if (editingId) {
        await api(`/knowledge-base/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setSuccess('Entry updated');
      } else {
        await api('/knowledge-base', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setSuccess('Entry created');
      }
      closeModal();
      await fetchEntries();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to save entry');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteLoading(true);
    setError('');
    setSuccess('');
    try {
      await api(`/knowledge-base/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Entry deleted');
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to delete entry');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleSaveAISettings(e: FormEvent) {
    e.preventDefault();
    const model = aiSettings.model.trim();
    if (!model) {
      setConfigError('Model is required');
      return;
    }

    setConfigSaving(true);
    setConfigError('');
    setConfigSuccess('');
    try {
      await api<AISettings>('/ai/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          provider: aiSettings.provider,
          model,
        }),
      });
      await fetchAIConfig();
      setConfigSuccess('AI configuration updated');
    } catch (err) {
      if (err instanceof ApiError) {
        setConfigError(err.message);
      } else {
        setConfigError('Failed to update AI configuration');
      }
    } finally {
      setConfigSaving(false);
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>AI Knowledge Base</h2>
            <p className={styles.sectionDescription}>
              Add company-specific information for AI-powered reply suggestions.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {aiStatus && (
              <Badge color={aiStatus.configured ? 'success' : 'warning'}>
                {aiStatus.configured
                  ? `AI Active (${providerLabel(aiStatus.provider)} · ${aiStatus.model})`
                  : `${providerLabel(aiStatus.provider)} API Key Not Set`}
              </Badge>
            )}
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              New Entry
            </Button>
          </div>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        <Card style={{ marginBottom: 'var(--space-4)' }}>
          {configLoading ? (
            <div className={styles.loadingState}>Loading AI configuration...</div>
          ) : (
            <form onSubmit={handleSaveAISettings} className={styles.connectForm} style={{ maxWidth: '860px' }}>
              <Select
                label="AI Provider"
                value={aiSettings.provider}
                onChange={(e) => {
                  const provider = e.target.value as AIProvider;
                  const nextModels = MODEL_OPTIONS[provider];
                  const hasCurrentModel = nextModels.some((m) => m.value === aiSettings.model);
                  setAiSettings((prev) => ({
                    provider,
                    model:
                      useCustomModel || hasCurrentModel
                        ? prev.model
                        : (nextModels[0]?.value ?? prev.model),
                  }));
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
              </Select>

              <Select
                label="Model"
                value={useCustomModel ? CUSTOM_MODEL_VALUE : aiSettings.model}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === CUSTOM_MODEL_VALUE) {
                    setUseCustomModel(true);
                    const seed =
                      customModel.trim() || aiSettings.model || MODEL_OPTIONS[aiSettings.provider][0]?.value || '';
                    setCustomModel(seed);
                    setAiSettings((prev) => ({ ...prev, model: seed }));
                    return;
                  }
                  setUseCustomModel(false);
                  setAiSettings((prev) => ({ ...prev, model: value }));
                }}
              >
                {!MODEL_OPTIONS[aiSettings.provider].some((m) => m.value === aiSettings.model) && (
                  <option value={aiSettings.model}>{aiSettings.model} (current)</option>
                )}
                {MODEL_OPTIONS[aiSettings.provider].map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
                <option value={CUSTOM_MODEL_VALUE}>Custom model...</option>
              </Select>

              {useCustomModel && (
                <Input
                  label="Custom Model ID"
                  placeholder={
                    aiSettings.provider === 'openrouter'
                      ? 'e.g. google/gemini-2.0-flash-001'
                      : 'e.g. gpt-4.1-nano'
                  }
                  value={customModel}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCustomModel(value);
                    setAiSettings((prev) => ({ ...prev, model: value }));
                  }}
                />
              )}

              <Button type="submit" size="md" disabled={configSaving || !aiSettings.model.trim()}>
                {configSaving ? 'Saving...' : 'Save AI Settings'}
              </Button>
            </form>
          )}
          {!configLoading && (
            <p className={styles.sectionDescription} style={{ marginTop: 'var(--space-3)' }}>
              {aiSettings.provider === 'openrouter'
                ? 'OpenRouter requires OPENROUTER_API_KEY in backend environment variables.'
                : 'OpenAI requires OPENAI_API_KEY in backend environment variables.'}
            </p>
          )}
        </Card>

        {configSuccess && <div className={styles.success}>{configSuccess}</div>}
        {configError && <div className={styles.alert}>{configError}</div>}

        <Card>
          <div className={styles.toolbar}>
            <form onSubmit={handleSearch} className={styles.searchInputWrap}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search knowledge base..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={styles.searchInput}
              />
            </form>

            <div className={styles.toolbarRight}>
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {total} entr{total !== 1 ? 'ies' : 'y'}
              </span>
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingState}>Loading entries...</div>
          ) : entries.length === 0 ? (
            <div className={styles.emptyState}>
              {search ? (
                <>
                  <p>No entries match your search.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearchInput('');
                      setSearch('');
                    }}
                  >
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <p>No knowledge base entries yet.</p>
                  <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                    Add entries like FAQs, product info, or company policies to improve AI suggestions.
                  </p>
                  <Button size="sm" onClick={openCreate}>
                    <Plus size={14} />
                    Create your first entry
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.templateList}>
              {entries.map((entry) => (
                <div key={entry.id} className={styles.templateRow}>
                  <div className={styles.templateInfo}>
                    <div className={styles.templateName}>{entry.title}</div>
                    <div className={styles.templateContent}>{entry.content}</div>
                  </div>
                  <div className={styles.templateActions}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openEdit(entry)}
                      title="Edit entry"
                    >
                      <Pencil size={15} />
                    </button>
                    {deletingId === entry.id ? (
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
                          onClick={() => handleDelete(entry.id)}
                          disabled={deleteLoading}
                        >
                          {deleteLoading ? 'Deleting...' : 'Delete'}
                        </Button>
                      </>
                    ) : (
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => setDeletingId(entry.id)}
                        title="Delete entry"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {editingId ? 'Edit Entry' : 'New Knowledge Base Entry'}
              </h3>
              <button className={styles.iconBtn} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className={styles.modalBody}>
                {formError && <div className={styles.alert}>{formError}</div>}
                <Input
                  label="Title"
                  placeholder="e.g. Return Policy, Product Pricing, Business Hours"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  error={formErrors.title}
                  required
                  autoFocus
                />
                <Textarea
                  label="Content"
                  placeholder="Enter the knowledge base content. This will be used by the AI to generate contextual replies."
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  error={formErrors.content}
                  rows={8}
                  required
                />
              </div>
              <div className={styles.modalFooter}>
                <Button type="button" variant="secondary" size="md" onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={saving}>
                  {saving
                    ? editingId
                      ? 'Saving...'
                      : 'Creating...'
                    : editingId
                      ? 'Save Changes'
                      : 'Create Entry'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
