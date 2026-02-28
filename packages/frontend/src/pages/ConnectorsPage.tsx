import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Cable, RefreshCw, Trash2, Bot, Plus, X, Settings, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '../layout';
import { Button, Input, Badge, Card } from '../ui';
import { api, ApiError } from '../lib/api';
import styles from './ConnectorsPage.module.css';

interface Connector {
  id: string;
  type: string;
  name: string;
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  capabilities: string[];
  integrationId: string;
  config: Record<string, unknown>;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  active: 'success',
  inactive: 'default',
  error: 'error',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Connected',
  inactive: 'Disconnected',
  error: 'Error',
};

const CONNECTOR_TYPES = [
  {
    id: 'telegram',
    name: 'Telegram',
    icon: Bot,
    description: 'Receive and send messages via Telegram bot',
  },
] as const;

type ConnectorTypeId = (typeof CONNECTOR_TYPES)[number]['id'];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<'type' | 'config'>('type');
  const [selectedType, setSelectedType] = useState<ConnectorTypeId | null>(null);
  const [token, setToken] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Settings modal
  const [settingsConnector, setSettingsConnector] = useState<Connector | null>(null);
  const [editSettings, setEditSettings] = useState<Record<string, unknown>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Refresh
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ entries: Connector[] }>('/connectors');
      setConnectors(data.entries);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to load connectors');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  // Create flow
  function openCreate() {
    setCreateStep('type');
    setSelectedType(null);
    setToken('');
    setCreateError('');
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    setSelectedType(null);
    setToken('');
    setCreateError('');
  }

  function handleSelectType(type: ConnectorTypeId) {
    setSelectedType(type);
    setCreateStep('config');
    setToken('');
    setCreateError('');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!selectedType || !token.trim()) return;

    setCreating(true);
    setCreateError('');
    try {
      await api('/connectors', {
        method: 'POST',
        body: JSON.stringify({ type: selectedType, token: token.trim() }),
      });
      closeCreate();
      showToast('success', 'Connector created successfully');
      await fetchConnectors();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create connector');
    } finally {
      setCreating(false);
    }
  }

  // Delete
  async function handleDelete(id: string) {
    setDeleteLoading(true);
    try {
      await api(`/connectors/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      showToast('success', 'Connector removed');
      setConnectors((prev) => prev.filter((c) => c.id !== id));
      if (settingsConnector?.id === id) setSettingsConnector(null);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to delete connector');
    } finally {
      setDeleteLoading(false);
    }
  }

  // Refresh
  async function handleRefresh(id: string) {
    setRefreshingId(id);
    try {
      await api(`/connectors/${id}/refresh`, { method: 'POST' });
      showToast('success', 'Connector refreshed');
      await fetchConnectors();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to refresh');
    } finally {
      setRefreshingId(null);
    }
  }

  // Settings
  function openSettings(connector: Connector) {
    setSettingsConnector(connector);
    setEditSettings({ ...connector.settings });
  }

  async function handleSaveSettings() {
    if (!settingsConnector) return;
    setSavingSettings(true);
    try {
      await api(`/connectors/${settingsConnector.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(editSettings),
      });
      showToast('success', 'Settings saved');
      setSettingsConnector(null);
      await fetchConnectors();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  }

  function renderSettingsFields() {
    if (!settingsConnector) return null;

    if (settingsConnector.type === 'telegram') {
      const enabled = (editSettings.autoGreetingEnabled as boolean) ?? false;
      const text = (editSettings.autoGreetingText as string) ?? '';
      return (
        <>
          <label className={styles.toggleRow}>
            <div>
              <div className={styles.toggleLabel}>Auto-greeting</div>
              <div className={styles.toggleHint}>Automatically greet new conversations</div>
            </div>
            <span className={styles.toggle}>
              <input
                type="checkbox"
                className={styles.toggleInput}
                checked={enabled}
                onChange={(e) =>
                  setEditSettings((s) => ({ ...s, autoGreetingEnabled: e.target.checked }))
                }
              />
              <span className={styles.toggleSlider} />
            </span>
          </label>
          {enabled && (
            <Input
              label="Greeting message"
              placeholder="Hello! How can we help you?"
              value={text}
              onChange={(e) =>
                setEditSettings((s) => ({ ...s, autoGreetingText: e.target.value || null }))
              }
            />
          )}
        </>
      );
    }

    return (
      <p className={styles.noSettings}>No configurable settings for this connector type.</p>
    );
  }

  const selectedTypeInfo = CONNECTOR_TYPES.find((t) => t.id === selectedType);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Connectors"
        description="Connect external services and data sources"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            Add Connector
          </Button>
        }
      />

      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {loading ? (
        <div className={styles.loadingState}>Loading connectors...</div>
      ) : connectors.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <Cable size={32} strokeWidth={1.5} />
          </div>
          <h3>No connectors yet</h3>
          <p>Connect an external service to start receiving and sending messages.</p>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            Add your first connector
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.counter}>
            {connectors.length} connector{connectors.length !== 1 ? 's' : ''}
          </div>
          <Card>
            <div className={styles.connectorList}>
              {connectors.map((connector) => (
                <div key={connector.id} className={styles.connectorCard}>
                  <div className={styles.connectorInfo}>
                    <div className={styles.connectorName}>
                      <span
                        className={styles.statusDot}
                        data-status={connector.status}
                      />
                      {connector.name}
                      <Badge color={STATUS_COLOR[connector.status]}>
                        {STATUS_LABEL[connector.status]}
                      </Badge>
                    </div>
                    <div className={styles.connectorDescription}>
                      {CONNECTOR_TYPES.find((t) => t.id === connector.type)?.name ?? connector.type}
                      {'botUsername' in connector.config && connector.config.botUsername
                        ? ` · @${String(connector.config.botUsername)}`
                        : ''}
                    </div>
                    <div className={styles.connectorMeta}>
                      {connector.capabilities.join(', ')}
                      {' · '}
                      Created {timeAgo(connector.createdAt)}
                      {connector.statusMessage && ` · ${connector.statusMessage}`}
                    </div>
                  </div>
                  <div className={styles.connectorActions}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openSettings(connector)}
                      title="Settings"
                    >
                      <Settings size={15} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => handleRefresh(connector.id)}
                      disabled={refreshingId === connector.id}
                      title="Refresh"
                    >
                      <RefreshCw
                        size={15}
                        className={refreshingId === connector.id ? 'spinning' : ''}
                      />
                    </button>
                    {deletingId === connector.id ? (
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
                          onClick={() => handleDelete(connector.id)}
                          disabled={deleteLoading}
                        >
                          {deleteLoading ? 'Removing...' : 'Remove'}
                        </Button>
                      </>
                    ) : (
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => setDeletingId(connector.id)}
                        title="Remove connector"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Create modal */}
      {createOpen && (
        <div className={styles.modalOverlay} onClick={closeCreate}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {createStep === 'type'
                  ? 'Add Connector'
                  : `Connect ${selectedTypeInfo?.name ?? ''}`}
              </h3>
              <button className={styles.iconBtn} onClick={closeCreate}>
                <X size={18} />
              </button>
            </div>

            {createStep === 'type' ? (
              <div className={styles.modalBody}>
                <div className={styles.typeGrid}>
                  {CONNECTOR_TYPES.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.id}
                        className={styles.typeCard}
                        onClick={() => handleSelectType(type.id)}
                      >
                        <div className={styles.typeIconWrap}>
                          <Icon size={24} />
                        </div>
                        <div className={styles.typeInfo}>
                          <div className={styles.typeName}>{type.name}</div>
                          <div className={styles.typeDescription}>{type.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreate}>
                <div className={styles.modalBody}>
                  <Input
                    label="Bot Token"
                    placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    error={createError}
                    autoFocus
                  />
                </div>
                <div className={styles.modalFooter}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setCreateStep('type');
                      setSelectedType(null);
                      setToken('');
                      setCreateError('');
                    }}
                  >
                    Back
                  </Button>
                  <Button type="submit" size="md" disabled={creating || !token.trim()}>
                    {creating ? 'Connecting...' : 'Connect'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Settings modal */}
      {settingsConnector && (
        <div className={styles.modalOverlay} onClick={() => setSettingsConnector(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{settingsConnector.name} Settings</h3>
              <button className={styles.iconBtn} onClick={() => setSettingsConnector(null)}>
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>{renderSettingsFields()}</div>
            <div className={styles.modalFooter}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setSettingsConnector(null)}
              >
                Cancel
              </Button>
              <Button size="md" onClick={handleSaveSettings} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
