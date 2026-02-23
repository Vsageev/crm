import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X } from 'lucide-react';
import { Button, Card, Input, Textarea } from '../../ui';
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

interface KBFormData {
  title: string;
  content: string;
}

const EMPTY_FORM: KBFormData = {
  title: '',
  content: '',
};

export function AIKnowledgeBaseTab() {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Knowledge Base</h2>
            <p className={styles.sectionDescription}>
              Add company-specific information such as FAQs, product info, or company policies.
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            New Entry
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
                  placeholder="Enter the knowledge base content."
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
