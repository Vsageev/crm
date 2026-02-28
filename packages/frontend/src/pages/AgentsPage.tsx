import { type FormEvent, useCallback, useState } from 'react';
import { Plus, Trash2, X, Power, PowerOff, ExternalLink, Key, Terminal } from 'lucide-react';
import { PageHeader } from '../layout';
import { Button, Card, Badge, Input, Textarea, Select, ApiKeyFormFields } from '../ui';
import { api } from '../lib/api';
import styles from './AgentsPage.module.css';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  isActive: boolean;
  expiresAt?: string | null;
}

interface ApiKeysResponse {
  total: number;
  limit: number;
  offset: number;
  entries: ApiKey[];
}

interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  status: 'active' | 'inactive' | 'error';
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  lastActivity: string | null;
  capabilities: string[];
  createdAt: string;
}

const MOCK_AGENTS: Agent[] = [
  {
    id: '1',
    name: 'Workflow Assistant',
    description: 'Handles inbound requests and schedules follow-ups automatically.',
    model: 'Claude',
    status: 'active',
    apiKeyId: 'key-1',
    apiKeyName: 'Workflow Integration',
    apiKeyPrefix: 'ws_live_a8f2',
    lastActivity: '2026-02-27T10:34:00Z',
    capabilities: ['contacts:read', 'cards:write', 'tasks:write'],
    createdAt: '2026-02-15T09:00:00Z',
  },
  {
    id: '2',
    name: 'Support Triage',
    description: 'Routes incoming messages to the right team member based on topic and urgency.',
    model: 'Claude',
    status: 'active',
    apiKeyId: 'key-2',
    apiKeyName: 'Support Key',
    apiKeyPrefix: 'ws_live_m4k1',
    lastActivity: '2026-02-27T09:58:00Z',
    capabilities: ['contacts:read', 'messages:read', 'messages:write'],
    createdAt: '2026-02-20T14:30:00Z',
  },
  {
    id: '3',
    name: 'Data Enrichment',
    description: 'Enriches contact and company records with public data.',
    model: 'Qwen',
    status: 'inactive',
    apiKeyId: 'key-3',
    apiKeyName: 'Enrichment Key',
    apiKeyPrefix: 'ws_live_9a3b',
    lastActivity: '2026-02-24T16:12:00Z',
    capabilities: ['contacts:write', 'companies:write'],
    createdAt: '2026-02-10T11:00:00Z',
  },
  {
    id: '4',
    name: 'Card Scorer',
    description: 'Scores cards based on engagement signals and predicts completion probability.',
    model: 'Codex',
    status: 'error',
    apiKeyId: 'key-4',
    apiKeyName: 'Scoring Key',
    apiKeyPrefix: 'ws_live_e7j5',
    lastActivity: null,
    capabilities: ['cards:read', 'cards:write', 'activities:read'],
    createdAt: '2026-02-22T08:45:00Z',
  },
];

const STATUS_COLOR: Record<Agent['status'], 'success' | 'default' | 'error'> = {
  active: 'success',
  inactive: 'default',
  error: 'error',
};

const STATUS_LABEL: Record<Agent['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
  error: 'Error',
};

const MODELS = [
  {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    description: 'Strong reasoning, safety-focused. Best for complex workflows.',
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    description: 'Code-first agent model. Good for dev-oriented tasks.',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    vendor: 'Alibaba',
    description: 'Open-weight model. Good for self-hosted deployments.',
  },
] as const;

type ModelId = (typeof MODELS)[number]['id'];

interface CreateAgentForm {
  name: string;
  description: string;
  model: ModelId;
  apiKeyId: string;
  newKey: boolean;
  newKeyPermissions: string[];
}

const EMPTY_FORM: CreateAgentForm = {
  name: '',
  description: '',
  model: 'claude',
  apiKeyId: '',
  newKey: false,
  newKeyPermissions: [],
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

let nextId = 5;

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>(MOCK_AGENTS);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateAgentForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // API keys from existing system
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);

  const fetchApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    try {
      const data = await api<ApiKeysResponse>('/api-keys?limit=100');
      setApiKeys(data.entries.filter((k) => k.isActive));
    } catch {
      // silently fail — the dropdown will just be empty
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  function openCreate() {
    setForm({ ...EMPTY_FORM, newKeyPermissions: [] });
    setFormErrors({});
    setCreateOpen(true);
    fetchApiKeys();
  }

  function closeCreate() {
    setCreateOpen(false);
    setForm({ ...EMPTY_FORM, newKeyPermissions: [] });
    setFormErrors({});
  }

  const selectedKey = apiKeys.find((k) => k.id === form.apiKeyId);
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Name is required';

    if (form.newKey) {
      if (form.newKeyPermissions.length === 0) errors.permissions = 'Select at least one permission';
    } else {
      if (!form.apiKeyId) errors.apiKeyId = 'Select an API key';
    }

    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const model = MODELS.find((m) => m.id === form.model)!;
    let keyId: string;
    let keyName: string;
    let keyPrefix: string;
    let permissions: string[];

    if (form.newKey) {
      const agentName = form.name.trim();
      setCreating(true);
      try {
        const body: Record<string, unknown> = {
          name: `${agentName} Key`,
          description: `Auto-created for agent "${agentName}"`,
          permissions: form.newKeyPermissions,
        };

        const created = await api<{ id: string; name: string; keyPrefix: string; permissions: string[] }>(
          '/api-keys',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        keyId = created.id;
        keyName = created.name;
        keyPrefix = created.keyPrefix;
        permissions = created.permissions;
      } catch {
        setFormErrors({ permissions: 'Failed to create API key' });
        setCreating(false);
        return;
      }
      setCreating(false);
    } else {
      const key = apiKeys.find((k) => k.id === form.apiKeyId)!;
      keyId = key.id;
      keyName = key.name;
      keyPrefix = key.keyPrefix;
      permissions = [...key.permissions];
    }

    const id = String(nextId++);

    const newAgent: Agent = {
      id,
      name: form.name.trim(),
      description: form.description.trim() || `${model.name} agent`,
      model: model.name,
      status: 'active',
      apiKeyId: keyId,
      apiKeyName: keyName,
      apiKeyPrefix: keyPrefix,
      lastActivity: null,
      capabilities: permissions,
      createdAt: new Date().toISOString(),
    };

    setAgents((prev) => [newAgent, ...prev]);
    closeCreate();
  }

  function handleToggle(id: string) {
    setAgents((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, status: a.status === 'active' ? 'inactive' : 'active' }
          : a,
      ),
    );
  }

  function handleDelete(id: string) {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    setDeletingId(null);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Agents"
        description="Local CLI agents that interact with your workspace data via API keys"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            Add Agent
          </Button>
        }
      />

      <div className={styles.counter}>
        {agents.length} agent{agents.length !== 1 ? 's' : ''}
      </div>

      <Card>
        {agents.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No agents connected yet.</p>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              Add your first agent
            </Button>
          </div>
        ) : (
          <div className={styles.agentList}>
            {agents.map((agent) => (
              <div key={agent.id} className={styles.agentCard}>
                <div className={styles.agentInfo}>
                  <div className={styles.agentName}>
                    {agent.name}
                    <Badge color={STATUS_COLOR[agent.status]}>
                      {STATUS_LABEL[agent.status]}
                    </Badge>
                  </div>
                  <div className={styles.agentDescription}>{agent.description}</div>
                  <div className={styles.agentMeta}>
                    <Terminal size={11} style={{ verticalAlign: 'middle' }} />
                    {' '}
                    {agent.model}
                    {' · '}
                    <Key size={11} style={{ verticalAlign: 'middle' }} />
                    {' '}
                    {agent.apiKeyName} ({agent.apiKeyPrefix}...)
                    {agent.lastActivity && (
                      <> · Last active {timeAgo(agent.lastActivity)}</>
                    )}
                  </div>
                  <div className={styles.agentCaps}>
                    {agent.capabilities.map((cap) => (
                      <Badge key={cap} color="default">{cap}</Badge>
                    ))}
                  </div>
                </div>
                <div className={styles.agentActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => setDetailAgent(agent)}
                    title="View details"
                  >
                    <ExternalLink size={15} />
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => handleToggle(agent.id)}
                    title={agent.status === 'active' ? 'Disable agent' : 'Enable agent'}
                  >
                    {agent.status === 'active' ? <PowerOff size={15} /> : <Power size={15} />}
                  </button>
                  {deletingId === agent.id ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setDeletingId(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => handleDelete(agent.id)}>
                        Delete
                      </Button>
                    </>
                  ) : (
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => setDeletingId(agent.id)}
                      title="Remove agent"
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

      {/* Create modal */}
      {createOpen && (
        <div className={styles.modalOverlay} onClick={closeCreate}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Add Agent</h3>
              <button className={styles.iconBtn} onClick={closeCreate}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className={styles.modalBody}>
                <Input
                  label="Name"
                  placeholder="e.g. Workflow Assistant"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  error={formErrors.name}
                  autoFocus
                />
                <Textarea
                  label="Description"
                  placeholder="What does this agent do?"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                />

                <div>
                  <div className={styles.fieldLabel}>Model</div>
                  <div className={styles.modelGrid}>
                    {MODELS.map((model) => (
                      <div
                        key={model.id}
                        className={[
                          styles.modelCard,
                          form.model === model.id && styles.modelCardSelected,
                        ].filter(Boolean).join(' ')}
                        onClick={() => setForm((f) => ({ ...f, model: model.id }))}
                      >
                        <div className={styles.modelName}>{model.name}</div>
                        <div className={styles.modelVendor}>{model.vendor}</div>
                        <div className={styles.modelDescription}>{model.description}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className={styles.fieldLabel}>API Key</div>
                  <div className={styles.keyModeTabs}>
                    <button
                      type="button"
                      className={`${styles.keyModeTab} ${!form.newKey ? styles.keyModeTabActive : ''}`}
                      onClick={() => setForm((f) => ({ ...f, newKey: false }))}
                    >
                      Use existing
                    </button>
                    <button
                      type="button"
                      className={`${styles.keyModeTab} ${form.newKey ? styles.keyModeTabActive : ''}`}
                      onClick={() => setForm((f) => ({ ...f, newKey: true }))}
                    >
                      <Plus size={13} />
                      Create new
                    </button>
                  </div>

                  {!form.newKey ? (
                    <>
                      <Select
                        value={form.apiKeyId}
                        onChange={(e) => setForm((f) => ({ ...f, apiKeyId: e.target.value }))}
                        error={formErrors.apiKeyId}
                      >
                        <option value="">
                          {apiKeysLoading ? 'Loading keys...' : 'Select an API key'}
                        </option>
                        {apiKeys.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name} ({k.keyPrefix}...)
                          </option>
                        ))}
                      </Select>

                      {selectedKey && (
                        <div className={styles.keyPermissions}>
                          <div className={styles.keyPermissionsLabel}>
                            Permissions from this key
                          </div>
                          <div className={styles.keyPermissionsList}>
                            {selectedKey.permissions.map((perm) => (
                              <Badge key={perm} color="info">{perm}</Badge>
                            ))}
                            {selectedKey.permissions.length === 0 && (
                              <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                                No permissions configured
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {apiKeys.length === 0 && !apiKeysLoading && (
                        <div className={styles.noKeysHint}>
                          No active API keys. Switch to "Create new" to make one now.
                        </div>
                      )}
                    </>
                  ) : (
                    <ApiKeyFormFields
                      permissionsOnly
                      form={{ name: '', description: '', permissions: form.newKeyPermissions, hasExpiration: false, expiresAt: '' }}
                      onChange={(updater) => {
                        setForm((f) => {
                          const next = updater({ name: '', description: '', permissions: f.newKeyPermissions, hasExpiration: false, expiresAt: '' });
                          return { ...f, newKeyPermissions: next.permissions };
                        });
                      }}
                      errors={{ permissions: formErrors.permissions }}
                    />
                  )}
                </div>
              </div>
              <div className={styles.modalFooter}>
                <Button type="button" variant="secondary" size="md" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Agent'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailAgent && (
        <div className={styles.modalOverlay} onClick={() => setDetailAgent(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{detailAgent.name}</h3>
              <button className={styles.iconBtn} onClick={() => setDetailAgent(null)}>
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div>
                <div className={styles.detailLabel}>Status</div>
                <Badge color={STATUS_COLOR[detailAgent.status]}>{STATUS_LABEL[detailAgent.status]}</Badge>
              </div>
              <div>
                <div className={styles.detailLabel}>Model</div>
                <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Terminal size={13} />
                  {detailAgent.model}
                </span>
              </div>
              <div>
                <div className={styles.detailLabel}>Description</div>
                <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{detailAgent.description}</span>
              </div>
              <div>
                <div className={styles.detailLabel}>API Key</div>
                <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Key size={13} />
                  {detailAgent.apiKeyName}
                  <code className={styles.detailCode}>{detailAgent.apiKeyPrefix}...</code>
                </span>
              </div>
              <div>
                <div className={styles.detailLabel}>Permissions</div>
                <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                  {detailAgent.capabilities.map((cap) => (
                    <Badge key={cap} color="info">{cap}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <div className={styles.detailLabel}>Last Activity</div>
                <span style={{ fontSize: 14 }}>
                  {detailAgent.lastActivity
                    ? new Date(detailAgent.lastActivity).toLocaleString()
                    : 'Never'}
                </span>
              </div>
              <div>
                <div className={styles.detailLabel}>Created</div>
                <span style={{ fontSize: 14 }}>{new Date(detailAgent.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <Button variant="secondary" size="md" onClick={() => setDetailAgent(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
