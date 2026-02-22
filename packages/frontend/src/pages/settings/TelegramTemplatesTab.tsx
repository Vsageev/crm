import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, Globe, Send } from 'lucide-react';
import { Button, Card, Input, Textarea, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../stores/useAuth';
import styles from './SettingsPage.module.css';

interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

interface TelegramTemplate {
  id: string;
  name: string;
  content: string;
  parseMode?: string | null;
  inlineKeyboard?: InlineKeyboardButton[][] | null;
  category?: string | null;
  isGlobal: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface TelegramTemplatesResponse {
  total: number;
  limit: number;
  offset: number;
  entries: TelegramTemplate[];
}

interface TemplateFormData {
  name: string;
  content: string;
  parseMode: string;
  inlineKeyboard: InlineKeyboardButton[][];
  category: string;
  isGlobal: boolean;
}

const EMPTY_FORM: TemplateFormData = {
  name: '',
  content: '',
  parseMode: '',
  inlineKeyboard: [],
  category: '',
  isGlobal: false,
};

function parseModeLabel(mode: string | null | undefined): string {
  if (mode === 'HTML') return 'HTML';
  if (mode === 'MarkdownV2') return 'Markdown';
  return 'Plain';
}

export function TelegramTemplatesTab() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  const [templates, setTemplates] = useState<TelegramTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const categories = Array.from(
    new Set(templates.map((t) => t.category).filter(Boolean) as string[]),
  ).sort();

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category', categoryFilter);

      const data = await api<TelegramTemplatesResponse>(
        `/telegram-message-templates?${params}`,
      );
      setTemplates(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load templates');
      }
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

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

  function openEdit(template: TelegramTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      content: template.content,
      parseMode: template.parseMode || '',
      inlineKeyboard: (template.inlineKeyboard as InlineKeyboardButton[][]) || [],
      category: template.category || '',
      isGlobal: template.isGlobal,
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
    if (!form.name.trim()) errors.name = 'Name is required';
    else if (form.name.length > 255) errors.name = 'Name must be 255 characters or less';
    if (!form.content.trim()) errors.content = 'Content is required';
    if (form.category && form.category.length > 100)
      errors.category = 'Category must be 100 characters or less';
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
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        content: form.content.trim(),
      };

      body.parseMode = form.parseMode || null;

      const validKeyboard = form.inlineKeyboard
        .map((row) => row.filter((btn) => btn.text.trim()))
        .filter((row) => row.length > 0);
      body.inlineKeyboard = validKeyboard.length > 0 ? validKeyboard : null;

      if (form.category.trim()) body.category = form.category.trim();
      else if (editingId) body.category = null;
      if (isAdminOrManager) body.isGlobal = form.isGlobal;

      if (editingId) {
        await api(`/telegram-message-templates/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setSuccess('Template updated');
      } else {
        await api('/telegram-message-templates', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setSuccess('Template created');
      }
      closeModal();
      await fetchTemplates();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to save template');
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
      await api(`/telegram-message-templates/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to delete template');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  function canEdit(template: TelegramTemplate) {
    return isAdminOrManager || template.createdBy === user?.id;
  }

  /* ── Inline keyboard helpers ── */
  function addKeyboardRow() {
    setForm((f) => ({
      ...f,
      inlineKeyboard: [...f.inlineKeyboard, [{ text: '', callback_data: '' }]],
    }));
  }

  function addButtonToRow(rowIndex: number) {
    setForm((f) => ({
      ...f,
      inlineKeyboard: f.inlineKeyboard.map((row, i) =>
        i === rowIndex ? [...row, { text: '', callback_data: '' }] : row,
      ),
    }));
  }

  function updateButton(
    rowIndex: number,
    btnIndex: number,
    field: keyof InlineKeyboardButton,
    value: string,
  ) {
    setForm((f) => ({
      ...f,
      inlineKeyboard: f.inlineKeyboard.map((row, ri) =>
        ri === rowIndex
          ? row.map((btn, bi) => (bi === btnIndex ? { ...btn, [field]: value } : btn))
          : row,
      ),
    }));
  }

  function removeButton(rowIndex: number, btnIndex: number) {
    setForm((f) => ({
      ...f,
      inlineKeyboard: f.inlineKeyboard
        .map((row, ri) => (ri === rowIndex ? row.filter((_, bi) => bi !== btnIndex) : row))
        .filter((row) => row.length > 0),
    }));
  }

  function removeKeyboardRow(rowIndex: number) {
    setForm((f) => ({
      ...f,
      inlineKeyboard: f.inlineKeyboard.filter((_, i) => i !== rowIndex),
    }));
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Telegram Message Templates</h2>
            <p className={styles.sectionDescription}>
              Create reusable Telegram message templates with formatting and inline keyboards.
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            New Template
          </Button>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        <Card>
          <div className={styles.toolbar}>
            <form onSubmit={handleSearch} className={styles.searchInputWrap}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={styles.searchInput}
              />
            </form>

            {categories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className={styles.filterSelect}
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}

            <div className={styles.toolbarRight}>
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {total} template{total !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingState}>Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className={styles.emptyState}>
              {search || categoryFilter ? (
                <>
                  <p>No templates match your filters.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearchInput('');
                      setSearch('');
                      setCategoryFilter('');
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <p>No Telegram templates yet.</p>
                  <Button size="sm" onClick={openCreate}>
                    <Plus size={14} />
                    Create your first template
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.templateList}>
              {templates.map((template) => (
                <div key={template.id} className={styles.templateRow}>
                  <div className={styles.templateInfo}>
                    <div className={styles.templateName}>
                      <Send size={13} style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--color-link)' }} />
                      {template.name}
                    </div>
                    <div className={styles.templateContent}>{template.content}</div>
                  </div>
                  <div className={styles.templateMeta}>
                    <Badge color="info">{parseModeLabel(template.parseMode)}</Badge>
                    {template.inlineKeyboard &&
                      (template.inlineKeyboard as InlineKeyboardButton[][]).length > 0 && (
                        <Badge color="default">
                          {(template.inlineKeyboard as InlineKeyboardButton[][]).reduce(
                            (sum, r) => sum + r.length,
                            0,
                          )}{' '}
                          btn
                        </Badge>
                      )}
                    {template.category && (
                      <Badge color="info">{template.category}</Badge>
                    )}
                    {template.isGlobal && (
                      <Badge color="default">
                        <Globe
                          size={11}
                          style={{ marginRight: 3, verticalAlign: 'middle' }}
                        />
                        Global
                      </Badge>
                    )}
                  </div>
                  {canEdit(template) && (
                    <div className={styles.templateActions}>
                      <button
                        className={styles.iconBtn}
                        onClick={() => openEdit(template)}
                        title="Edit template"
                      >
                        <Pencil size={15} />
                      </button>
                      {deletingId === template.id ? (
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
                            onClick={() => handleDelete(template.id)}
                            disabled={deleteLoading}
                          >
                            {deleteLoading ? 'Deleting...' : 'Delete'}
                          </Button>
                        </>
                      ) : (
                        <button
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => setDeletingId(template.id)}
                          title="Delete template"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
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
                {editingId ? 'Edit Telegram Template' : 'New Telegram Template'}
              </h3>
              <button className={styles.iconBtn} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className={styles.modalBody}>
                {formError && <div className={styles.alert}>{formError}</div>}
                <Input
                  label="Name"
                  placeholder="e.g. Welcome message"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  error={formErrors.name}
                  required
                  autoFocus
                />
                <Textarea
                  label="Content"
                  placeholder="Type the template message content..."
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                  error={formErrors.content}
                  rows={5}
                  required
                />
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 500,
                        marginBottom: 6,
                        color: 'var(--color-text)',
                      }}
                    >
                      Parse Mode
                    </label>
                    <select
                      value={form.parseMode}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, parseMode: e.target.value }))
                      }
                      className={styles.filterSelect}
                      style={{ width: '100%', padding: '8px 28px 8px 10px' }}
                    >
                      <option value="">Plain text</option>
                      <option value="HTML">HTML</option>
                      <option value="MarkdownV2">MarkdownV2</option>
                    </select>
                  </div>
                  <Input
                    label="Category"
                    placeholder="e.g. greeting, support"
                    value={form.category}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, category: e.target.value }))
                    }
                    error={formErrors.category}
                  />
                </div>

                {/* Inline Keyboard Builder */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--color-text)',
                      }}
                    >
                      Inline Keyboard
                    </label>
                    <button
                      type="button"
                      onClick={addKeyboardRow}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 8px',
                        fontSize: 12,
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'none',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      <Plus size={12} /> Add row
                    </button>
                  </div>
                  {form.inlineKeyboard.length === 0 ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--color-text-tertiary)',
                        padding: '8px 0',
                      }}
                    >
                      No buttons. Add a row to include an inline keyboard.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        padding: 12,
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-surface)',
                      }}
                    >
                      {form.inlineKeyboard.map((row, ri) => (
                        <div key={ri}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 4,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 500,
                                color: 'var(--color-text-tertiary)',
                                textTransform: 'uppercase',
                              }}
                            >
                              Row {ri + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeKeyboardRow(ri)}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--color-text-tertiary)',
                                padding: 2,
                              }}
                              title="Remove row"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {row.map((btn, bi) => (
                            <div
                              key={bi}
                              style={{
                                display: 'flex',
                                gap: 6,
                                marginBottom: 4,
                                alignItems: 'center',
                              }}
                            >
                              <input
                                type="text"
                                placeholder="Button text"
                                value={btn.text}
                                onChange={(e) =>
                                  updateButton(ri, bi, 'text', e.target.value)
                                }
                                style={{
                                  flex: 1,
                                  padding: '5px 8px',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 13,
                                  background: 'var(--color-card)',
                                  color: 'var(--color-text)',
                                }}
                              />
                              <input
                                type="text"
                                placeholder="Callback data or URL"
                                value={btn.url || btn.callback_data || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (
                                    val.startsWith('http://') ||
                                    val.startsWith('https://')
                                  ) {
                                    updateButton(ri, bi, 'url', val);
                                    updateButton(ri, bi, 'callback_data', '');
                                  } else {
                                    updateButton(ri, bi, 'callback_data', val);
                                    updateButton(ri, bi, 'url', '');
                                  }
                                }}
                                style={{
                                  flex: 1,
                                  padding: '5px 8px',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 13,
                                  background: 'var(--color-card)',
                                  color: 'var(--color-text)',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => removeButton(ri, bi)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--color-text-tertiary)',
                                  padding: 2,
                                }}
                                title="Remove button"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addButtonToRow(ri)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 6px',
                              fontSize: 11,
                              border: 'none',
                              background: 'none',
                              color: 'var(--color-link)',
                              cursor: 'pointer',
                            }}
                          >
                            <Plus size={10} /> Add button
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {isAdminOrManager && (
                  <label
                    className={styles.toggleRow}
                    style={{ border: 'none', cursor: 'pointer' }}
                  >
                    <div>
                      <div className={styles.toggleLabel}>Global template</div>
                      <div className={styles.toggleDescription}>
                        Make this template available to all team members
                      </div>
                    </div>
                    <div className={styles.toggle}>
                      <input
                        type="checkbox"
                        className={styles.toggleInput}
                        checked={form.isGlobal}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, isGlobal: e.target.checked }))
                        }
                      />
                      <span className={styles.toggleSlider} />
                    </div>
                  </label>
                )}
              </div>
              <div className={styles.modalFooter}>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={closeModal}
                >
                  Cancel
                </Button>
                <Button type="submit" size="md" disabled={saving}>
                  {saving
                    ? editingId
                      ? 'Saving...'
                      : 'Creating...'
                    : editingId
                      ? 'Save Changes'
                      : 'Create Template'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
