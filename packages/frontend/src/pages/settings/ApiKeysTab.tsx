import React, { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Copy, Check, AlertTriangle } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

const API_RESOURCES = [
  'contacts', 'deals', 'tasks', 'pipelines',
  'messages', 'activities', 'templates', 'webhooks',
] as const;

type AccessLevel = 'none' | 'read' | 'write';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  description?: string | null;
  isActive: boolean;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiKeysResponse {
  total: number;
  limit: number;
  offset: number;
  entries: ApiKey[];
}

interface CreateApiKeyResponse extends ApiKey {
  key: string;
}

interface ApiKeyFormData {
  name: string;
  description: string;
  permissions: string[];
  hasExpiration: boolean;
  expiresAt: string;
  isActive: boolean;
}

const EMPTY_FORM: ApiKeyFormData = {
  name: '',
  description: '',
  permissions: [],
  hasExpiration: false,
  expiresAt: '',
  isActive: true,
};

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ApiKeyFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Created key reveal
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<ApiKeysResponse>('/api-keys?limit=100');
      setKeys(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load API keys');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormError('');
    setCreatedKey(null);
    setModalOpen(true);
  }

  function openEdit(key: ApiKey) {
    setEditingId(key.id);
    setForm({
      name: key.name,
      description: key.description || '',
      permissions: [...key.permissions],
      hasExpiration: Boolean(key.expiresAt),
      expiresAt: key.expiresAt ? key.expiresAt.slice(0, 16) : '',
      isActive: key.isActive,
    });
    setFormErrors({});
    setFormError('');
    setCreatedKey(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormError('');
    setCreatedKey(null);
    setCopied(false);
  }

  function getResourceLevel(resource: string): AccessLevel {
    if (form.permissions.includes(`${resource}:write`)) return 'write';
    if (form.permissions.includes(`${resource}:read`)) return 'read';
    return 'none';
  }

  function setResourceLevel(resource: string, level: AccessLevel) {
    setForm((f) => {
      const filtered = f.permissions.filter((p) => !p.startsWith(`${resource}:`));
      if (level === 'write') filtered.push(`${resource}:write`);
      else if (level === 'read') filtered.push(`${resource}:read`);
      return { ...f, permissions: filtered };
    });
  }

  function setAllResources(level: AccessLevel) {
    setForm((f) => {
      const permissions: string[] = [];
      for (const resource of API_RESOURCES) {
        if (level === 'write') permissions.push(`${resource}:write`);
        else if (level === 'read') permissions.push(`${resource}:read`);
      }
      return { ...f, permissions };
    });
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    else if (form.name.length > 255) errors.name = 'Name must be 255 characters or less';
    if (!editingId && form.permissions.length === 0) errors.permissions = 'Select at least one permission';
    if (form.description && form.description.length > 1000) errors.description = 'Description must be 1000 characters or less';
    if (form.hasExpiration) {
      if (!form.expiresAt) {
        errors.expiresAt = 'Expiration date and time is required';
      } else {
        const expiresAt = new Date(form.expiresAt);
        if (Number.isNaN(expiresAt.getTime())) {
          errors.expiresAt = 'Invalid expiration date';
        } else if (expiresAt <= new Date()) {
          errors.expiresAt = 'Expiration must be in the future';
        }
      }
    }
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
      if (editingId) {
        const body: Record<string, unknown> = {
          name: form.name.trim(),
          isActive: form.isActive,
        };
        if (form.description.trim()) body.description = form.description.trim();
        else body.description = null;
        if (form.permissions.length > 0) body.permissions = form.permissions;
        body.expiresAt = form.hasExpiration ? new Date(form.expiresAt).toISOString() : null;

        await api(`/api-keys/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setSuccess('API key updated');
        closeModal();
        await fetchKeys();
      } else {
        const body: Record<string, unknown> = {
          name: form.name.trim(),
          permissions: form.permissions,
        };
        if (form.description.trim()) body.description = form.description.trim();
        if (form.hasExpiration) body.expiresAt = new Date(form.expiresAt).toISOString();

        const result = await api<CreateApiKeyResponse>('/api-keys', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setCreatedKey(result.key);
        setSuccess('API key created');
        await fetchKeys();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to save API key');
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
      await api(`/api-keys/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('API key deleted');
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to delete API key');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleCopy() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text for manual copy
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>API Keys</h2>
            <p className={styles.sectionDescription}>
              Create and manage API keys for programmatic access to your CRM.
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            New API Key
          </Button>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        <Card>
          <div className={styles.toolbarRight} style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {total} key{total !== 1 ? 's' : ''}
            </span>
          </div>

          {loading ? (
            <div className={styles.loadingState}>Loading API keys...</div>
          ) : keys.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No API keys yet.</p>
              <Button size="sm" onClick={openCreate}>
                <Plus size={14} />
                Create your first API key
              </Button>
            </div>
          ) : (
            <div className={styles.templateList}>
              {keys.map((key) => (
                <div key={key.id} className={styles.templateRow}>
                  <div className={styles.templateInfo}>
                    <div className={styles.templateName}>{key.name}</div>
                    <div className={styles.templateContent}>
                      {key.keyPrefix}...
                      {key.description && ` — ${key.description}`}
                    </div>
                  </div>
                  <div className={styles.templateMeta}>
                    {key.permissions.slice(0, 3).map((perm) => (
                      <Badge key={perm} color="info">{perm}</Badge>
                    ))}
                    {key.permissions.length > 3 && (
                      <Badge color="default">+{key.permissions.length - 3}</Badge>
                    )}
                    <Badge color={key.isActive ? 'success' : 'default'}>
                      {key.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {key.expiresAt ? (
                      <Badge color={new Date(key.expiresAt) < new Date() ? 'error' : 'default'}>
                        {new Date(key.expiresAt) < new Date()
                          ? 'Expired'
                          : `Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                      </Badge>
                    ) : (
                      <Badge color="default">No expiry</Badge>
                    )}
                  </div>
                  <div className={styles.templateActions}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openEdit(key)}
                      title="Edit API key"
                    >
                      <Pencil size={15} />
                    </button>
                    {deletingId === key.id ? (
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
                          onClick={() => handleDelete(key.id)}
                          disabled={deleteLoading}
                        >
                          {deleteLoading ? 'Deleting...' : 'Delete'}
                        </Button>
                      </>
                    ) : (
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => setDeletingId(key.id)}
                        title="Delete API key"
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
                {createdKey ? 'API Key Created' : editingId ? 'Edit API Key' : 'New API Key'}
              </h3>
              <button className={styles.iconBtn} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            {createdKey ? (
              <div className={styles.modalBody}>
                <div className={styles.alert} style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  borderColor: 'rgba(245, 158, 11, 0.2)',
                  color: 'var(--color-text)',
                }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, color: '#f59e0b', marginTop: 1 }} />
                  <span>Copy this key now. It will not be shown again.</span>
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-3)',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  wordBreak: 'break-all',
                }}>
                  <span style={{ flex: 1 }}>{createdKey}</span>
                  <button
                    className={styles.iconBtn}
                    onClick={handleCopy}
                    title="Copy to clipboard"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <div className={styles.modalFooter} style={{ padding: 0, borderTop: 'none' }}>
                  <Button variant="secondary" size="md" onClick={closeModal}>
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSave}>
                <div className={styles.modalBody}>
                  {formError && <div className={styles.alert}>{formError}</div>}
                  <Input
                    label="Name"
                    placeholder="e.g. Production integration"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    error={formErrors.name}
                    required
                    autoFocus
                  />
                  <Input
                    label="Description"
                    placeholder="Optional description"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    error={formErrors.description}
                  />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 'var(--space-2)', color: 'var(--color-text)' }}>
                      Expiration
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        fontSize: 14,
                        color: 'var(--color-text)',
                        cursor: 'pointer',
                      }}>
                        <input
                          type="radio"
                          name="expiration-mode"
                          checked={!form.hasExpiration}
                          onChange={() => setForm((f) => ({ ...f, hasExpiration: false }))}
                        />
                        <span>Never expires</span>
                      </label>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        fontSize: 14,
                        color: 'var(--color-text)',
                        cursor: 'pointer',
                      }}>
                        <input
                          type="radio"
                          name="expiration-mode"
                          checked={form.hasExpiration}
                          onChange={() => setForm((f) => ({ ...f, hasExpiration: true }))}
                        />
                        <span>Set expiration date and time</span>
                      </label>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>
                      {form.hasExpiration
                        ? 'The key stops working at this date and time (your local timezone).'
                        : 'The key stays valid until you disable or delete it.'}
                    </div>
                  </div>

                  {form.hasExpiration && (
                    <Input
                      label="Expires At"
                      type="datetime-local"
                      value={form.expiresAt}
                      onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                      error={formErrors.expiresAt}
                    />
                  )}

                  {editingId && (
                    <label className={styles.toggleRow} style={{ border: 'none', cursor: 'pointer' }}>
                      <div>
                        <div className={styles.toggleLabel}>Active</div>
                        <div className={styles.toggleDescription}>
                          Disable to temporarily revoke access without deleting the key
                        </div>
                      </div>
                      <div className={styles.toggle}>
                        <input
                          type="checkbox"
                          className={styles.toggleInput}
                          checked={form.isActive}
                          onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                        />
                        <span className={styles.toggleSlider} />
                      </div>
                    </label>
                  )}

                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 'var(--space-2)', color: 'var(--color-text)' }}>
                      Permissions
                    </div>
                    {formErrors.permissions && (
                      <div className={styles.fieldError}>{formErrors.permissions}</div>
                    )}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto auto',
                      gap: 'var(--space-1) var(--space-3)',
                      alignItems: 'center',
                      marginTop: 'var(--space-2)',
                      fontSize: 13,
                    }}>
                      {/* Header */}
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)' }}>Resource</div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center' }}>None</div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center' }}>Read</div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center' }}>Write</div>

                      {/* Set all row */}
                      <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>Set all</div>
                      {(['none', 'read', 'write'] as const).map((level) => (
                        <div key={level} style={{ textAlign: 'center' }}>
                          <input
                            type="radio"
                            name="set-all"
                            checked={API_RESOURCES.every((r) => getResourceLevel(r) === level)}
                            onChange={() => setAllResources(level)}
                            style={{ cursor: 'pointer' }}
                          />
                        </div>
                      ))}

                      {/* Separator */}
                      <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid var(--color-border)', margin: 'var(--space-1) 0' }} />

                      {/* Per-resource rows */}
                      {API_RESOURCES.map((resource) => (
                        <React.Fragment key={resource}>
                          <div style={{ textTransform: 'capitalize', color: 'var(--color-text)' }}>{resource}</div>
                          {(['none', 'read', 'write'] as const).map((level) => (
                            <div key={level} style={{ textAlign: 'center' }}>
                              <input
                                type="radio"
                                name={`perm-${resource}`}
                                checked={getResourceLevel(resource) === level}
                                onChange={() => setResourceLevel(resource, level)}
                                style={{ cursor: 'pointer' }}
                              />
                            </div>
                          ))}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
                <div className={styles.modalFooter}>
                  <Button type="button" variant="secondary" size="md" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button type="submit" size="md" disabled={saving}>
                    {saving
                      ? editingId ? 'Saving...' : 'Creating...'
                      : editingId ? 'Save Changes' : 'Create Key'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
