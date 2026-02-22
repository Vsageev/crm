import { type FormEvent, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Input, Select, Textarea } from '../../ui';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/error-messages';
import styles from './TaskFormPage.module.css';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'medium' | 'high';
type TaskType = 'call' | 'meeting' | 'email' | 'follow_up' | 'other';

interface TaskData {
  id: string;
  title: string;
  description?: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  assigneeId?: string | null;
}

interface ContactOption {
  id: string;
  firstName: string;
  lastName?: string | null;
}

interface DealOption {
  id: string;
  title: string;
}

const TYPES: { value: TaskType; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'email', label: 'Email' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'other', label: 'Other' },
];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

function formatDateForInput(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function TaskFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>('other');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [contactId, setContactId] = useState('');
  const [dealId, setDealId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);

  // Fetch options for dropdowns
  useEffect(() => {
    async function fetchOptions() {
      try {
        const [contactsRes, dealsRes] = await Promise.all([
          api<{ entries: ContactOption[] }>('/contacts?limit=200'),
          api<{ entries: DealOption[] }>('/deals?limit=200'),
        ]);
        setContacts(contactsRes.entries);
        setDeals(dealsRes.entries);
      } catch {
        // Options are non-critical, fail silently
      }
    }
    fetchOptions();
  }, []);

  // Fetch existing task for edit
  useEffect(() => {
    if (!id) return;

    async function fetchTask() {
      setFetching(true);
      try {
        const data = await api<TaskData>(`/tasks/${id}`);
        setTitle(data.title);
        setDescription(data.description || '');
        setType(data.type);
        setStatus(data.status);
        setPriority(data.priority);
        setDueDate(formatDateForInput(data.dueDate));
        setContactId(data.contactId || '');
        setDealId(data.dealId || '');
        setAssigneeId(data.assigneeId || '');
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setFetching(false);
      }
    }

    fetchTask();
  }, [id]);

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!title.trim()) {
      errors.title = 'Title is required';
    } else if (title.length > 255) {
      errors.title = 'Title must be 255 characters or less';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        type,
        status,
        priority,
      };

      if (description.trim()) body.description = description.trim();
      else if (isEdit) body.description = null;

      if (dueDate) body.dueDate = new Date(dueDate).toISOString();
      else if (isEdit) body.dueDate = null;

      if (contactId) body.contactId = contactId;
      else if (isEdit) body.contactId = null;

      if (dealId) body.dealId = dealId;
      else if (isEdit) body.dealId = null;

      if (assigneeId) body.assigneeId = assigneeId;
      else if (isEdit) body.assigneeId = null;

      if (isEdit) {
        await api(`/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        navigate(`/tasks/${id}`, { replace: true });
      } else {
        const created = await api<TaskData>('/tasks', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        navigate(`/tasks/${created.id}`, { replace: true });
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
        <PageHeader title={isEdit ? 'Edit Task' : 'New Task'} />
        <div className={styles.loadingState}>Loading task...</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Task' : 'New Task'}
        description={isEdit ? 'Update task details' : 'Create a new task'}
      />

      <div className={styles.backLink}>
        <Link to={isEdit ? `/tasks/${id}` : '/tasks'} className={styles.back}>
          <ArrowLeft size={14} />
          {isEdit ? 'Back to Task' : 'All Tasks'}
        </Link>
      </div>

      <Card className={styles.formCard}>
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <div className={styles.alert}>{error}</div>}

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Task Details</h3>
            <Input
              label="Title"
              placeholder="e.g. Follow up with client"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={fieldErrors.title}
              required
              autoFocus
            />

            <Textarea
              label="Description"
              placeholder="Additional details about this task..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Classification</h3>
            <div className={styles.row}>
              <Select
                label="Type"
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>

              <Select
                label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className={styles.row}>
              <Select
                label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>

              <Input
                label="Due Date"
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Associations</h3>
            <div className={styles.row}>
              <Select
                label="Contact"
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
              >
                <option value="">None</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[c.firstName, c.lastName].filter(Boolean).join(' ')}
                  </option>
                ))}
              </Select>

              <Select
                label="Deal"
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
              >
                <option value="">None</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className={styles.formActions}>
            <Link to={isEdit ? `/tasks/${id}` : '/tasks'}>
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
                  : 'Create Task'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
