import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, X, Copy, Check, Code, MessageCircle } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

/* ── Types ── */

interface WebChatWidget {
  id: string;
  name: string;
  welcomeMessage: string;
  placeholderText: string;
  brandColor: string;
  position: string;
  autoGreetingEnabled: boolean;
  autoGreetingDelaySec: string;
  requireEmail: boolean;
  requireName: boolean;
  allowedOrigins: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLOR: Record<string, 'success' | 'default'> = {
  active: 'success',
  inactive: 'default',
};

export function WebChatTab() {
  const [widgets, setWidgets] = useState<WebChatWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create/Edit form
  const [showForm, setShowForm] = useState(false);
  const [editingWidget, setEditingWidget] = useState<WebChatWidget | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    welcomeMessage: 'Hi there! How can we help you?',
    placeholderText: 'Type a message...',
    brandColor: '#2D2D2D',
    position: 'bottom-right',
    autoGreetingEnabled: true,
    autoGreetingDelaySec: '3',
    requireEmail: false,
    requireName: false,
    allowedOrigins: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Embed code copy
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchWidgets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: WebChatWidget[] }>('/web-chat/widgets');
      setWidgets(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load widgets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWidgets();
  }, [fetchWidgets]);

  function resetForm() {
    setFormData({
      name: '',
      welcomeMessage: 'Hi there! How can we help you?',
      placeholderText: 'Type a message...',
      brandColor: '#2D2D2D',
      position: 'bottom-right',
      autoGreetingEnabled: true,
      autoGreetingDelaySec: '3',
      requireEmail: false,
      requireName: false,
      allowedOrigins: '',
    });
    setEditingWidget(null);
    setFormError('');
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(widget: WebChatWidget) {
    setEditingWidget(widget);
    setFormData({
      name: widget.name,
      welcomeMessage: widget.welcomeMessage,
      placeholderText: widget.placeholderText || 'Type a message...',
      brandColor: widget.brandColor,
      position: widget.position,
      autoGreetingEnabled: widget.autoGreetingEnabled,
      autoGreetingDelaySec: widget.autoGreetingDelaySec,
      requireEmail: widget.requireEmail,
      requireName: widget.requireName,
      allowedOrigins: widget.allowedOrigins || '',
    });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSaving(true);
    setFormError('');
    try {
      if (editingWidget) {
        await api(`/web-chat/widgets/${editingWidget.id}`, {
          method: 'PATCH',
          body: JSON.stringify(formData),
        });
        setSuccess('Widget updated successfully');
      } else {
        await api('/web-chat/widgets', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        setSuccess('Widget created successfully');
      }
      setShowForm(false);
      resetForm();
      await fetchWidgets();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save widget');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/web-chat/widgets/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Widget deleted successfully');
      setWidgets((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete widget');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleToggleStatus(widget: WebChatWidget) {
    const newStatus = widget.status === 'active' ? 'inactive' : 'active';
    try {
      await api(`/web-chat/widgets/${widget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      setSuccess(`Widget ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      await fetchWidgets();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update widget');
    }
  }

  function getEmbedCode(widget: WebChatWidget): string {
    const baseUrl = window.location.origin;
    return `<script src="${baseUrl}/chat-widget.js" data-crm-chat-widget="${widget.id}" data-crm-api-url="${baseUrl}" defer></script>`;
  }

  async function copyEmbedCode(widget: WebChatWidget) {
    try {
      await navigator.clipboard.writeText(getEmbedCode(widget));
      setCopiedId(widget.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = getEmbedCode(widget);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(widget.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Web Chat Widgets</h2>
            <p className={styles.sectionDescription}>
              Create embeddable chat widgets for your website. Visitors can chat with your agents in real-time.
            </p>
          </div>
          <Button size="sm" onClick={openCreateForm}>
            <Plus size={14} style={{ marginRight: 4 }} /> New Widget
          </Button>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.loadingState}>Loading widgets...</div>
        ) : widgets.length === 0 && !showForm ? (
          <Card>
            <div className={styles.emptyState}>
              <MessageCircle size={32} />
              <p>No chat widgets created yet.</p>
              <p>Create a widget and embed it on your website to start receiving chat messages.</p>
            </div>
          </Card>
        ) : null}

        {/* Widget list */}
        {widgets.length > 0 && (
          <div className={styles.botList}>
            {widgets.map((widget) => (
              <div key={widget.id} className={styles.botCard}>
                <div className={styles.botInfo}>
                  <div className={styles.botName}>
                    <MessageCircle size={14} color={widget.status === 'active' ? 'var(--color-success)' : 'var(--color-text-tertiary)'} />
                    {widget.name}
                    <Badge color={STATUS_COLOR[widget.status]}>{widget.status}</Badge>
                  </div>
                  <div className={styles.botUsername}>
                    Color: {widget.brandColor} &middot; Position: {widget.position}
                  </div>
                  <div className={styles.botMeta}>
                    Created {new Date(widget.createdAt).toLocaleDateString()}
                    {widget.requireEmail && ' · Email required'}
                    {widget.requireName && ' · Name required'}
                  </div>
                </div>
                <div className={styles.botActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => copyEmbedCode(widget)}
                    title="Copy embed code"
                  >
                    {copiedId === widget.id ? <Check size={16} color="var(--color-success)" /> : <Code size={16} />}
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => openEditForm(widget)}
                    title="Edit widget"
                  >
                    <Pencil size={16} />
                  </button>
                  <label className={styles.toggle} title={widget.status === 'active' ? 'Deactivate' : 'Activate'}>
                    <input
                      type="checkbox"
                      className={styles.toggleInput}
                      checked={widget.status === 'active'}
                      onChange={() => handleToggleStatus(widget)}
                    />
                    <span className={styles.toggleSlider} />
                  </label>
                  {deletingId === widget.id ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setDeletingId(null)} disabled={deleteLoading}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => handleDelete(widget.id)} disabled={deleteLoading}>
                        {deleteLoading ? 'Deleting...' : 'Confirm'}
                      </Button>
                    </>
                  ) : (
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => setDeletingId(widget.id)}
                      title="Delete widget"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showForm && (
        <div className={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && setShowForm(false)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {editingWidget ? 'Edit Chat Widget' : 'Create Chat Widget'}
              </h3>
              <button className={styles.iconBtn} onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className={styles.modalBody}>
                {formError && <div className={styles.alert}>{formError}</div>}

                <Input
                  label="Widget Name"
                  placeholder="e.g. Main Website Chat"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />

                <Input
                  label="Welcome Message"
                  placeholder="Hi there! How can we help you?"
                  value={formData.welcomeMessage}
                  onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
                />

                <Input
                  label="Input Placeholder"
                  placeholder="Type a message..."
                  value={formData.placeholderText}
                  onChange={(e) => setFormData({ ...formData, placeholderText: e.target.value })}
                />

                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        marginBottom: '6px',
                        color: 'var(--color-text)',
                      }}
                    >
                      Brand Color
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="color"
                        value={formData.brandColor}
                        onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })}
                        style={{ width: '36px', height: '36px', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                      />
                      <Input
                        value={formData.brandColor}
                        onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })}
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        marginBottom: '6px',
                        color: 'var(--color-text)',
                      }}
                    >
                      Position
                    </label>
                    <select
                      className={styles.filterSelect}
                      value={formData.position}
                      onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', fontSize: '14px' }}
                    >
                      <option value="bottom-right">Bottom Right</option>
                      <option value="bottom-left">Bottom Left</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 500,
                      marginBottom: '10px',
                      color: 'var(--color-text)',
                    }}
                  >
                    Pre-chat Requirements
                  </label>
                  <div className={styles.toggleList}>
                    <div className={styles.toggleRow}>
                      <div>
                        <div className={styles.toggleLabel}>Require Name</div>
                        <div className={styles.toggleDescription}>Ask visitors for their name before chatting</div>
                      </div>
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          className={styles.toggleInput}
                          checked={formData.requireName}
                          onChange={(e) => setFormData({ ...formData, requireName: e.target.checked })}
                        />
                        <span className={styles.toggleSlider} />
                      </label>
                    </div>
                    <div className={styles.toggleRow}>
                      <div>
                        <div className={styles.toggleLabel}>Require Email</div>
                        <div className={styles.toggleDescription}>Ask visitors for their email before chatting</div>
                      </div>
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          className={styles.toggleInput}
                          checked={formData.requireEmail}
                          onChange={(e) => setFormData({ ...formData, requireEmail: e.target.checked })}
                        />
                        <span className={styles.toggleSlider} />
                      </label>
                    </div>
                    <div className={styles.toggleRow}>
                      <div>
                        <div className={styles.toggleLabel}>Auto Greeting</div>
                        <div className={styles.toggleDescription}>Send welcome message automatically</div>
                      </div>
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          className={styles.toggleInput}
                          checked={formData.autoGreetingEnabled}
                          onChange={(e) => setFormData({ ...formData, autoGreetingEnabled: e.target.checked })}
                        />
                        <span className={styles.toggleSlider} />
                      </label>
                    </div>
                  </div>
                </div>

                <Input
                  label="Allowed Origins (optional)"
                  placeholder="e.g. https://example.com, https://app.example.com"
                  value={formData.allowedOrigins}
                  onChange={(e) => setFormData({ ...formData, allowedOrigins: e.target.value })}
                />
                <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginTop: '-8px' }}>
                  Comma-separated domains. Leave empty to allow all origins.
                </div>

                {/* Embed code preview */}
                {editingWidget && (
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 500,
                        marginBottom: '6px',
                        color: 'var(--color-text)',
                      }}
                    >
                      Embed Code
                    </label>
                    <div
                      style={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                        padding: '12px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        lineHeight: '1.5',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {getEmbedCode(editingWidget)}
                    </div>
                    <button
                      type="button"
                      style={{
                        marginTop: '8px',
                        fontSize: '13px',
                        color: 'var(--color-link)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      onClick={() => copyEmbedCode(editingWidget)}
                    >
                      {copiedId === editingWidget.id ? <Check size={14} /> : <Copy size={14} />}
                      {copiedId === editingWidget.id ? 'Copied!' : 'Copy to clipboard'}
                    </button>
                  </div>
                )}
              </div>
              <div className={styles.modalFooter}>
                <Button type="button" variant="secondary" size="md" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={saving || !formData.name.trim()}>
                  {saving ? 'Saving...' : editingWidget ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
