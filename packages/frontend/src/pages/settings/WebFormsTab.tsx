import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  FileText,
  GripVertical,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Code,
  ClipboardList,
} from 'lucide-react';
import { Button, Card, Input, Textarea, Badge, Select } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

/* ── Types ── */

interface WebFormField {
  id?: string;
  label: string;
  fieldType: string;
  placeholder?: string;
  isRequired: boolean;
  position: number;
  options?: string[] | null;
  defaultValue?: string | null;
  contactFieldMapping?: string | null;
}

interface WebForm {
  id: string;
  name: string;
  description?: string | null;
  status: 'active' | 'inactive' | 'archived';
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  assigneeId?: string | null;
  submitButtonText: string;
  successMessage: string;
  redirectUrl?: string | null;
  fields: WebFormField[];
  createdAt: string;
  updatedAt: string;
}

interface WebFormsResponse {
  total: number;
  limit: number;
  offset: number;
  entries: WebForm[];
}

interface Pipeline {
  id: string;
  name: string;
  stages: { id: string; name: string; position: number }[];
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface Submission {
  id: string;
  data: Record<string, unknown>;
  status: string;
  ipAddress?: string | null;
  referrerUrl?: string | null;
  utmSource?: string | null;
  createdAt: string;
}

interface SubmissionsResponse {
  total: number;
  entries: Submission[];
}

/* ── Field type metadata ── */

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
  { value: 'hidden', label: 'Hidden' },
] as const;

const CONTACT_FIELD_MAPPINGS = [
  { value: '', label: 'None' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'company', label: 'Company' },
] as const;

/* ── Empty form state ── */

interface FormData {
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'archived';
  pipelineId: string;
  pipelineStageId: string;
  assigneeId: string;
  submitButtonText: string;
  successMessage: string;
  redirectUrl: string;
  fields: WebFormField[];
}

const EMPTY_FIELD: WebFormField = {
  label: '',
  fieldType: 'text',
  placeholder: '',
  isRequired: false,
  position: 0,
  options: null,
  defaultValue: null,
  contactFieldMapping: null,
};

const EMPTY_FORM: FormData = {
  name: '',
  description: '',
  status: 'active',
  pipelineId: '',
  pipelineStageId: '',
  assigneeId: '',
  submitButtonText: 'Submit',
  successMessage: 'Thank you for your submission!',
  redirectUrl: '',
  fields: [],
};

/* ── Component ── */

export function WebFormsTab() {
  // List state
  const [forms, setForms] = useState<WebForm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Reference data
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  // Embed code
  const [embedFormId, setEmbedFormId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Submissions
  const [submissionsFormId, setSubmissionsFormId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);

  // Preview
  const [previewFormId, setPreviewFormId] = useState<string | null>(null);

  /* ── Fetch forms ── */

  const fetchForms = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const data = await api<WebFormsResponse>(`/web-forms?${params}`);
      setForms(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load forms');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  /* ── Fetch reference data ── */

  useEffect(() => {
    api<{ entries: Pipeline[] }>('/pipelines?limit=100')
      .then((d) => setPipelines(d.entries))
      .catch(() => {});
    api<{ entries: UserOption[] }>('/users?limit=100')
      .then((d) => setUsers(d.entries))
      .catch(() => {});
  }, []);

  /* ── Handlers ── */

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, fields: [{ ...EMPTY_FIELD, label: 'Name', fieldType: 'text', isRequired: true, position: 0, contactFieldMapping: 'firstName' }, { ...EMPTY_FIELD, label: 'Email', fieldType: 'email', isRequired: true, position: 1, contactFieldMapping: 'email' }] });
    setFormErrors({});
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(webForm: WebForm) {
    setEditingId(webForm.id);
    setForm({
      name: webForm.name,
      description: webForm.description || '',
      status: webForm.status,
      pipelineId: webForm.pipelineId || '',
      pipelineStageId: webForm.pipelineStageId || '',
      assigneeId: webForm.assigneeId || '',
      submitButtonText: webForm.submitButtonText,
      successMessage: webForm.successMessage,
      redirectUrl: webForm.redirectUrl || '',
      fields: webForm.fields.map((f) => ({ ...f })),
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
    if (form.fields.length === 0) errors.fields = 'At least one field is required';
    for (let i = 0; i < form.fields.length; i++) {
      if (!form.fields[i].label.trim()) {
        errors[`field_${i}_label`] = 'Label is required';
      }
      if (form.fields[i].fieldType === 'select') {
        const opts = form.fields[i].options;
        if (!opts || opts.length === 0) {
          errors[`field_${i}_options`] = 'Dropdown fields need at least one option';
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
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        status: form.status,
        submitButtonText: form.submitButtonText.trim() || 'Submit',
        successMessage: form.successMessage.trim() || 'Thank you for your submission!',
        redirectUrl: form.redirectUrl.trim() || null,
        pipelineId: form.pipelineId || null,
        pipelineStageId: form.pipelineStageId || null,
        assigneeId: form.assigneeId || null,
        fields: form.fields.map((f, i) => ({
          label: f.label.trim(),
          fieldType: f.fieldType,
          placeholder: f.placeholder?.trim() || undefined,
          isRequired: f.isRequired,
          position: i,
          options: f.fieldType === 'select' ? (f.options || []).filter((o) => o.trim()) : undefined,
          defaultValue: f.defaultValue?.trim() || undefined,
          contactFieldMapping: f.contactFieldMapping || undefined,
        })),
      };

      if (editingId) {
        await api(`/web-forms/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setSuccess('Form updated');
      } else {
        await api('/web-forms', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setSuccess('Form created');
      }
      closeModal();
      await fetchForms();
    } catch (err) {
      if (err instanceof ApiError) setFormError(err.message);
      else setFormError('Failed to save form');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteLoading(true);
    setError('');
    setSuccess('');
    try {
      await api(`/web-forms/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Form deleted');
      setForms((prev) => prev.filter((f) => f.id !== id));
      setTotal((prev) => prev - 1);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to delete form');
    } finally {
      setDeleteLoading(false);
    }
  }

  /* ── Field helpers ── */

  function addField() {
    setForm((f) => ({
      ...f,
      fields: [...f.fields, { ...EMPTY_FIELD, position: f.fields.length }],
    }));
  }

  function removeField(index: number) {
    setForm((f) => ({
      ...f,
      fields: f.fields.filter((_, i) => i !== index),
    }));
  }

  function updateField(index: number, updates: Partial<WebFormField>) {
    setForm((f) => ({
      ...f,
      fields: f.fields.map((field, i) => (i === index ? { ...field, ...updates } : field)),
    }));
  }

  function moveField(index: number, direction: 'up' | 'down') {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= form.fields.length) return;
    setForm((f) => {
      const fields = [...f.fields];
      [fields[index], fields[newIndex]] = [fields[newIndex], fields[index]];
      return { ...f, fields };
    });
  }

  function addOption(fieldIndex: number) {
    updateField(fieldIndex, {
      options: [...(form.fields[fieldIndex].options || []), ''],
    });
  }

  function updateOption(fieldIndex: number, optIndex: number, value: string) {
    const opts = [...(form.fields[fieldIndex].options || [])];
    opts[optIndex] = value;
    updateField(fieldIndex, { options: opts });
  }

  function removeOption(fieldIndex: number, optIndex: number) {
    const opts = (form.fields[fieldIndex].options || []).filter((_, i) => i !== optIndex);
    updateField(fieldIndex, { options: opts });
  }

  /* ── Embed code ── */

  function getEmbedCode(formId: string) {
    const baseUrl = window.location.origin;
    return `<div id="crm-form-${formId}"></div>
<script src="${baseUrl}/widget.js"></script>
<script>
  CRM.renderForm({
    formId: '${formId}',
    container: '#crm-form-${formId}',
    apiUrl: '${baseUrl}'
  });
</script>`;
  }

  async function copyEmbedCode(formId: string) {
    try {
      await navigator.clipboard.writeText(getEmbedCode(formId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  /* ── Submissions ── */

  async function loadSubmissions(formId: string) {
    setSubmissionsFormId(formId);
    setSubmissionsLoading(true);
    try {
      const data = await api<SubmissionsResponse>(`/web-forms/${formId}/submissions?limit=50`);
      setSubmissions(data.entries);
      setSubmissionsTotal(data.total);
    } catch {
      setSubmissions([]);
      setSubmissionsTotal(0);
    } finally {
      setSubmissionsLoading(false);
    }
  }

  /* ── Pipeline stages for selected pipeline ── */

  const selectedPipeline = pipelines.find((p) => p.id === form.pipelineId);
  const stages = selectedPipeline?.stages || [];

  /* ── Preview form ── */

  const previewForm = previewFormId ? forms.find((f) => f.id === previewFormId) : null;

  /* ── Render ── */

  const statusBadgeColor = (s: string) => {
    if (s === 'active') return 'success' as const;
    if (s === 'inactive') return 'warning' as const;
    return 'default' as const;
  };

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Web Forms</h2>
            <p className={styles.sectionDescription}>
              Create embeddable lead capture forms that auto-create contacts and deals.
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} />
            New Form
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
                placeholder="Search forms..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={styles.searchInput}
              />
            </form>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>

            <div className={styles.toolbarRight}>
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {total} form{total !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingState}>Loading forms...</div>
          ) : forms.length === 0 ? (
            <div className={styles.emptyState}>
              {search || statusFilter ? (
                <>
                  <p>No forms match your filters.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearchInput('');
                      setSearch('');
                      setStatusFilter('');
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <p>No web forms yet.</p>
                  <Button size="sm" onClick={openCreate}>
                    <Plus size={14} />
                    Create your first form
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.templateList}>
              {forms.map((webForm) => (
                <div key={webForm.id} className={styles.templateRow}>
                  <div className={styles.templateInfo}>
                    <div className={styles.templateName}>
                      <FileText
                        size={13}
                        style={{
                          marginRight: 6,
                          verticalAlign: 'middle',
                          color: 'var(--color-link)',
                        }}
                      />
                      {webForm.name}
                    </div>
                    <div className={styles.templateContent}>
                      {webForm.fields.length} field{webForm.fields.length !== 1 ? 's' : ''}
                      {webForm.description ? ` — ${webForm.description}` : ''}
                    </div>
                  </div>
                  <div className={styles.templateMeta}>
                    <Badge color={statusBadgeColor(webForm.status)}>{webForm.status}</Badge>
                  </div>
                  <div className={styles.templateActions}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => setPreviewFormId(previewFormId === webForm.id ? null : webForm.id)}
                      title="Preview form"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() =>
                        setEmbedFormId(embedFormId === webForm.id ? null : webForm.id)
                      }
                      title="Embed code"
                    >
                      <Code size={15} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() =>
                        submissionsFormId === webForm.id
                          ? setSubmissionsFormId(null)
                          : loadSubmissions(webForm.id)
                      }
                      title="View submissions"
                    >
                      <ClipboardList size={15} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openEdit(webForm)}
                      title="Edit form"
                    >
                      <Pencil size={15} />
                    </button>
                    {deletingId === webForm.id ? (
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
                          onClick={() => handleDelete(webForm.id)}
                          disabled={deleteLoading}
                        >
                          {deleteLoading ? 'Deleting...' : 'Delete'}
                        </Button>
                      </>
                    ) : (
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => setDeletingId(webForm.id)}
                        title="Delete form"
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

        {/* ── Embed code panel ── */}
        {embedFormId && (
          <div style={{ marginTop: 16 }}>
            <Card>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    Embed Code
                  </h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Button size="sm" variant="secondary" onClick={() => copyEmbedCode(embedFormId)}>
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                    <button className={styles.iconBtn} onClick={() => setEmbedFormId(null)}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <pre
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 16,
                    fontSize: 13,
                    lineHeight: 1.5,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {getEmbedCode(embedFormId)}
                </pre>
              </div>
            </Card>
          </div>
        )}

        {/* ── Preview panel ── */}
        {previewForm && (
          <div style={{ marginTop: 16 }}>
            <Card>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    Preview: {previewForm.name}
                  </h3>
                  <button className={styles.iconBtn} onClick={() => setPreviewFormId(null)}>
                    <X size={16} />
                  </button>
                </div>
                <div
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 24,
                    maxWidth: 480,
                  }}
                >
                  {previewForm.description && (
                    <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                      {previewForm.description}
                    </p>
                  )}
                  {previewForm.fields
                    .sort((a, b) => a.position - b.position)
                    .map((field, i) => (
                      <div key={i} style={{ marginBottom: 14 }}>
                        {field.fieldType !== 'hidden' && (
                          <label
                            style={{
                              display: 'block',
                              fontSize: 13,
                              fontWeight: 500,
                              marginBottom: 4,
                              color: 'var(--color-text)',
                            }}
                          >
                            {field.label}
                            {field.isRequired && (
                              <span style={{ color: 'var(--color-error)', marginLeft: 2 }}>*</span>
                            )}
                          </label>
                        )}
                        {field.fieldType === 'textarea' ? (
                          <textarea
                            placeholder={field.placeholder || ''}
                            disabled
                            rows={3}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 14,
                              background: 'var(--color-card)',
                              color: 'var(--color-text)',
                              resize: 'vertical',
                            }}
                          />
                        ) : field.fieldType === 'select' ? (
                          <select
                            disabled
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 14,
                              background: 'var(--color-card)',
                              color: 'var(--color-text)',
                            }}
                          >
                            <option value="">Select...</option>
                            {(field.options || []).map((opt, oi) => (
                              <option key={oi} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : field.fieldType === 'checkbox' ? (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                            <input type="checkbox" disabled />
                            {field.label}
                          </label>
                        ) : field.fieldType !== 'hidden' ? (
                          <input
                            type={field.fieldType === 'email' ? 'email' : field.fieldType === 'phone' ? 'tel' : field.fieldType === 'number' ? 'number' : field.fieldType === 'date' ? 'date' : field.fieldType === 'url' ? 'url' : 'text'}
                            placeholder={field.placeholder || ''}
                            disabled
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: 14,
                              background: 'var(--color-card)',
                              color: 'var(--color-text)',
                            }}
                          />
                        ) : null}
                      </div>
                    ))}
                  <button
                    disabled
                    style={{
                      width: '100%',
                      padding: '10px 20px',
                      background: 'var(--color-primary-brand)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: 'default',
                      marginTop: 4,
                    }}
                  >
                    {previewForm.submitButtonText}
                  </button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ── Submissions panel ── */}
        {submissionsFormId && (
          <div style={{ marginTop: 16 }}>
            <Card>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    Submissions ({submissionsTotal})
                  </h3>
                  <button className={styles.iconBtn} onClick={() => setSubmissionsFormId(null)}>
                    <X size={16} />
                  </button>
                </div>
                {submissionsLoading ? (
                  <div className={styles.loadingState}>Loading submissions...</div>
                ) : submissions.length === 0 ? (
                  <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', padding: '20px 0', textAlign: 'center' }}>
                    No submissions yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {submissions.map((sub) => (
                      <div
                        key={sub.id}
                        style={{
                          padding: '12px 16px',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-surface)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <Badge color={sub.status === 'new' ? 'info' : sub.status === 'processed' ? 'success' : 'error'}>
                            {sub.status}
                          </Badge>
                          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                            {new Date(sub.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                          {Object.entries(sub.data).map(([key, value]) => (
                            <div key={key} style={{ marginBottom: 2 }}>
                              <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{key}:</span>{' '}
                              {String(value)}
                            </div>
                          ))}
                        </div>
                        {(sub.utmSource || sub.referrerUrl) && (
                          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                            {sub.utmSource && <>Source: {sub.utmSource} </>}
                            {sub.referrerUrl && <>Referrer: {sub.referrerUrl}</>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ── Create/Edit Modal ── */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div
            className={styles.modal}
            style={{ maxWidth: 640 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {editingId ? 'Edit Web Form' : 'New Web Form'}
              </h3>
              <button className={styles.iconBtn} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className={styles.modalBody}>
                {formError && <div className={styles.alert}>{formError}</div>}

                {/* Basic info */}
                <Input
                  label="Form Name"
                  placeholder="e.g. Contact Us"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  error={formErrors.name}
                  required
                  autoFocus
                />
                <Textarea
                  label="Description"
                  placeholder="Optional description shown on the form"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  <Select
                    label="Status"
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as FormData['status'] }))
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </Select>
                  <Select
                    label="Assign to"
                    value={form.assigneeId}
                    onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Pipeline integration */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  <Select
                    label="Pipeline"
                    value={form.pipelineId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pipelineId: e.target.value, pipelineStageId: '' }))
                    }
                  >
                    <option value="">No pipeline</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Initial Stage"
                    value={form.pipelineStageId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, pipelineStageId: e.target.value }))
                    }
                    disabled={!form.pipelineId}
                  >
                    <option value="">First stage</option>
                    {stages
                      .sort((a, b) => a.position - b.position)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </Select>
                </div>

                {/* Customization */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  <Input
                    label="Submit Button Text"
                    placeholder="Submit"
                    value={form.submitButtonText}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, submitButtonText: e.target.value }))
                    }
                  />
                  <Input
                    label="Redirect URL"
                    placeholder="https://example.com/thanks"
                    value={form.redirectUrl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, redirectUrl: e.target.value }))
                    }
                  />
                </div>
                <Textarea
                  label="Success Message"
                  placeholder="Thank you for your submission!"
                  value={form.successMessage}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, successMessage: e.target.value }))
                  }
                  rows={2}
                />

                {/* ── Fields builder ── */}
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
                      Form Fields
                    </label>
                    <button
                      type="button"
                      onClick={addField}
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
                      <Plus size={12} /> Add field
                    </button>
                  </div>

                  {formErrors.fields && (
                    <div style={{ fontSize: 13, color: 'var(--color-error)', marginBottom: 8 }}>
                      {formErrors.fields}
                    </div>
                  )}

                  {form.fields.length === 0 ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--color-text-tertiary)',
                        padding: '8px 0',
                      }}
                    >
                      No fields. Add a field to build your form.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {form.fields.map((field, fi) => (
                        <div
                          key={fi}
                          style={{
                            padding: 12,
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--color-surface)',
                          }}
                        >
                          {/* Field header with reorder/delete */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 8,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <GripVertical
                                size={14}
                                style={{ color: 'var(--color-text-tertiary)' }}
                              />
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 500,
                                  color: 'var(--color-text-secondary)',
                                  textTransform: 'uppercase',
                                }}
                              >
                                Field {fi + 1}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <button
                                type="button"
                                onClick={() => moveField(fi, 'up')}
                                disabled={fi === 0}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: fi === 0 ? 'default' : 'pointer',
                                  color:
                                    fi === 0
                                      ? 'var(--color-border)'
                                      : 'var(--color-text-tertiary)',
                                  padding: 2,
                                }}
                                title="Move up"
                              >
                                <ChevronUp size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveField(fi, 'down')}
                                disabled={fi === form.fields.length - 1}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor:
                                    fi === form.fields.length - 1 ? 'default' : 'pointer',
                                  color:
                                    fi === form.fields.length - 1
                                      ? 'var(--color-border)'
                                      : 'var(--color-text-tertiary)',
                                  padding: 2,
                                }}
                                title="Move down"
                              >
                                <ChevronDown size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeField(fi)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--color-text-tertiary)',
                                  padding: 2,
                                }}
                                title="Remove field"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Field configuration */}
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 8,
                            }}
                          >
                            <div>
                              <input
                                type="text"
                                placeholder="Field label"
                                value={field.label}
                                onChange={(e) =>
                                  updateField(fi, { label: e.target.value })
                                }
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  border: `1px solid ${formErrors[`field_${fi}_label`] ? 'var(--color-error)' : 'var(--color-border)'}`,
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 13,
                                  background: 'var(--color-card)',
                                  color: 'var(--color-text)',
                                }}
                              />
                              {formErrors[`field_${fi}_label`] && (
                                <span style={{ fontSize: 12, color: 'var(--color-error)' }}>
                                  {formErrors[`field_${fi}_label`]}
                                </span>
                              )}
                            </div>
                            <select
                              value={field.fieldType}
                              onChange={(e) =>
                                updateField(fi, { fieldType: e.target.value })
                              }
                              className={styles.filterSelect}
                              style={{ width: '100%', padding: '6px 28px 6px 8px' }}
                            >
                              {FIELD_TYPES.map((ft) => (
                                <option key={ft.value} value={ft.value}>
                                  {ft.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: 8,
                              marginTop: 8,
                            }}
                          >
                            <input
                              type="text"
                              placeholder="Placeholder text"
                              value={field.placeholder || ''}
                              onChange={(e) =>
                                updateField(fi, { placeholder: e.target.value })
                              }
                              style={{
                                width: '100%',
                                padding: '6px 8px',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 13,
                                background: 'var(--color-card)',
                                color: 'var(--color-text)',
                              }}
                            />
                            <select
                              value={field.contactFieldMapping || ''}
                              onChange={(e) =>
                                updateField(fi, {
                                  contactFieldMapping: e.target.value || null,
                                })
                              }
                              className={styles.filterSelect}
                              style={{ width: '100%', padding: '6px 28px 6px 8px' }}
                            >
                              {CONTACT_FIELD_MAPPINGS.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.value ? `Map → ${m.label}` : 'No mapping'}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 16,
                              marginTop: 8,
                            }}
                          >
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 13,
                                color: 'var(--color-text-secondary)',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={field.isRequired}
                                onChange={(e) =>
                                  updateField(fi, { isRequired: e.target.checked })
                                }
                              />
                              Required
                            </label>

                            {field.fieldType === 'hidden' && (
                              <input
                                type="text"
                                placeholder="Default / hidden value"
                                value={field.defaultValue || ''}
                                onChange={(e) =>
                                  updateField(fi, { defaultValue: e.target.value })
                                }
                                style={{
                                  flex: 1,
                                  padding: '4px 8px',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 13,
                                  background: 'var(--color-card)',
                                  color: 'var(--color-text)',
                                }}
                              />
                            )}
                          </div>

                          {/* Select options */}
                          {field.fieldType === 'select' && (
                            <div style={{ marginTop: 8 }}>
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
                                    fontSize: 12,
                                    color: 'var(--color-text-tertiary)',
                                  }}
                                >
                                  Options
                                </span>
                                <button
                                  type="button"
                                  onClick={() => addOption(fi)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    padding: '2px 6px',
                                    fontSize: 11,
                                    border: 'none',
                                    background: 'none',
                                    color: 'var(--color-link)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <Plus size={10} /> Add
                                </button>
                              </div>
                              {formErrors[`field_${fi}_options`] && (
                                <span style={{ fontSize: 12, color: 'var(--color-error)' }}>
                                  {formErrors[`field_${fi}_options`]}
                                </span>
                              )}
                              {(field.options || []).map((opt, oi) => (
                                <div
                                  key={oi}
                                  style={{
                                    display: 'flex',
                                    gap: 4,
                                    marginBottom: 4,
                                    alignItems: 'center',
                                  }}
                                >
                                  <input
                                    type="text"
                                    placeholder={`Option ${oi + 1}`}
                                    value={opt}
                                    onChange={(e) =>
                                      updateOption(fi, oi, e.target.value)
                                    }
                                    style={{
                                      flex: 1,
                                      padding: '4px 8px',
                                      border: '1px solid var(--color-border)',
                                      borderRadius: 'var(--radius-sm)',
                                      fontSize: 13,
                                      background: 'var(--color-card)',
                                      color: 'var(--color-text)',
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeOption(fi, oi)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: 'var(--color-text-tertiary)',
                                      padding: 2,
                                    }}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
                      : 'Create Form'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
