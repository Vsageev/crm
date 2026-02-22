import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, Globe } from 'lucide-react';
import { Button, Card, Input, Textarea, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../stores/useAuth';
import styles from './SettingsPage.module.css';

interface Template {
  id: string;
  name: string;
  content: string;
  category?: string | null;
  shortcut?: string | null;
  isGlobal: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface TemplatesResponse {
  total: number;
  limit: number;
  offset: number;
  entries: Template[];
}

interface TemplateFormData {
  name: string;
  content: string;
  category: string;
  shortcut: string;
  isGlobal: boolean;
}

const EMPTY_FORM: TemplateFormData = {
  name: '',
  content: '',
  category: '',
  shortcut: '',
  isGlobal: false,
};

export function TemplatesTab() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  const [templates, setTemplates] = useState<Template[]>([]);
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

  // Collect unique categories from templates
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

      const data = await api<TemplatesResponse>(`/quick-reply-templates?${params}`);
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

  function openEdit(template: Template) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      content: template.content,
      category: template.category || '',
      shortcut: template.shortcut || '',
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
    if (form.shortcut && form.shortcut.length > 100)
      errors.shortcut = 'Shortcut must be 100 characters or less';
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
      if (form.category.trim()) body.category = form.category.trim();
      else if (editingId) body.category = null;
      if (form.shortcut.trim()) body.shortcut = form.shortcut.trim();
      else if (editingId) body.shortcut = null;
      if (isAdminOrManager) body.isGlobal = form.isGlobal;

      if (editingId) {
        await api(`/quick-reply-templates/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setSuccess('Template updated');
      } else {
        await api('/quick-reply-templates', {
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
      await api(`/quick-reply-templates/${id}`, { method: 'DELETE' });
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

  function canEdit(template: Template) {
    return isAdminOrManager || template.createdBy === user?.id;
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Quick-Reply Templates</h2>
            <p className={styles.sectionDescription}>
              Create reusable message templates for faster replies.
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
                  <p>No templates yet.</p>
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
                      {template.name}
                      {template.shortcut && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                          /{template.shortcut}
                        </span>
                      )}
                    </div>
                    <div className={styles.templateContent}>{template.content}</div>
                  </div>
                  <div className={styles.templateMeta}>
                    {template.category && (
                      <Badge color="info">{template.category}</Badge>
                    )}
                    {template.isGlobal && (
                      <Badge color="default">
                        <Globe size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
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
                {editingId ? 'Edit Template' : 'New Template'}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  <Input
                    label="Category"
                    placeholder="e.g. greeting, support"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    error={formErrors.category}
                  />
                  <Input
                    label="Shortcut"
                    placeholder="e.g. welcome"
                    value={form.shortcut}
                    onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
                    error={formErrors.shortcut}
                  />
                </div>
                {isAdminOrManager && (
                  <label className={styles.toggleRow} style={{ border: 'none', cursor: 'pointer' }}>
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
                        onChange={(e) => setForm((f) => ({ ...f, isGlobal: e.target.checked }))}
                      />
                      <span className={styles.toggleSlider} />
                    </div>
                  </label>
                )}
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
