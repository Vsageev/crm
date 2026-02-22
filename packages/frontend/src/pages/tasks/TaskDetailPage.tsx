import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Calendar,
  Clock,
  CheckCircle2,
  Circle,
  XCircle,
  AlertTriangle,
  Flag,
  Tag,
  User,
  Briefcase,
} from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { useQuery, invalidateQueries } from '../../lib/useQuery';
import styles from './TaskDetailPage.module.css';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'medium' | 'high';
type TaskType = 'call' | 'meeting' | 'email' | 'follow_up' | 'other';

interface Task {
  id: string;
  title: string;
  description?: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  completedAt?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  assigneeId?: string | null;
  createdById?: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<TaskStatus, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'default',
};

const STATUS_ICONS: Record<TaskStatus, typeof Circle> = {
  pending: Circle,
  in_progress: Clock,
  completed: CheckCircle2,
  cancelled: XCircle,
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const PRIORITY_COLORS: Record<TaskPriority, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
  low: 'default',
  medium: 'warning',
  high: 'error',
};

const TYPE_LABELS: Record<TaskType, string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  follow_up: 'Follow Up',
  other: 'Other',
};

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: task, loading, error, refetch } = useQuery<Task>(
    id ? `/tasks/${id}` : null,
  );
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) {
      return;
    }
    setDeleting(true);
    try {
      await api(`/tasks/${id}`, { method: 'DELETE' });
      invalidateQueries('/tasks');
      navigate('/tasks', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setActionError(err.message);
      } else {
        setActionError('Failed to delete task');
      }
      setDeleting(false);
    }
  }

  async function handleToggleComplete() {
    if (!task) return;
    const newStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await api<Task>(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      invalidateQueries('/tasks');
      refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        setActionError(err.message);
      }
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Task" />
        <div className={styles.loadingState}>Loading task...</div>
      </div>
    );
  }

  const displayError = error || actionError;

  if (displayError || !task) {
    return (
      <div>
        <PageHeader title="Task" />
        <Card>
          <div className={styles.errorState}>
            <p>{displayError || 'Task not found'}</p>
            <Link to="/tasks">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                Back to Tasks
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[task.status];

  return (
    <div>
      <PageHeader
        title={task.title}
        actions={
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="md"
              onClick={handleToggleComplete}
            >
              {task.status === 'completed' ? (
                <>
                  <Circle size={16} />
                  Reopen
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  Complete
                </>
              )}
            </Button>
            <Link to={`/tasks/${id}/edit`}>
              <Button variant="secondary" size="md">
                <Edit2 size={16} />
                Edit
              </Button>
            </Link>
            <Button variant="secondary" size="md" onClick={handleDelete} disabled={deleting}>
              <Trash2 size={16} />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        }
      />

      <div className={styles.backLink}>
        <Link to="/tasks" className={styles.back}>
          <ArrowLeft size={14} />
          All Tasks
        </Link>
      </div>

      <div className={styles.grid}>
        <Card>
          <div className={styles.headerSection}>
            <div className={styles.statusBadges}>
              <Badge color={STATUS_COLORS[task.status]}>
                <StatusIcon size={12} />
                {STATUS_LABELS[task.status]}
              </Badge>
              <Badge color={PRIORITY_COLORS[task.priority]}>
                {PRIORITY_LABELS[task.priority]} Priority
              </Badge>
              {task.isOverdue && (
                <Badge color="error">
                  <AlertTriangle size={12} />
                  Overdue
                </Badge>
              )}
            </div>
          </div>

          {task.description && (
            <div className={styles.descriptionSection}>
              <h3 className={styles.sectionTitle}>Description</h3>
              <p className={styles.description}>{task.description}</p>
            </div>
          )}

          <div className={styles.details}>
            <div className={styles.detailRow}>
              <Tag size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Type</span>
                <span className={styles.detailValue}>{TYPE_LABELS[task.type]}</span>
              </div>
            </div>

            <div className={styles.detailRow}>
              <Flag size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Priority</span>
                <span className={styles.detailValue}>{PRIORITY_LABELS[task.priority]}</span>
              </div>
            </div>

            {task.dueDate && (
              <div className={styles.detailRow}>
                <Calendar size={16} className={task.isOverdue ? styles.detailIconOverdue : styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Due Date</span>
                  <span className={task.isOverdue ? styles.detailValueOverdue : styles.detailValue}>
                    {new Date(task.dueDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            )}

            {task.completedAt && (
              <div className={styles.detailRow}>
                <CheckCircle2 size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Completed</span>
                  <span className={styles.detailValue}>
                    {new Date(task.completedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            )}

            {task.contactId && (
              <div className={styles.detailRow}>
                <User size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Contact</span>
                  <Link to={`/contacts/${task.contactId}`} className={styles.detailLink}>
                    View Contact
                  </Link>
                </div>
              </div>
            )}

            {task.dealId && (
              <div className={styles.detailRow}>
                <Briefcase size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Deal</span>
                  <Link to={`/deals?id=${task.dealId}`} className={styles.detailLink}>
                    View Deal
                  </Link>
                </div>
              </div>
            )}

            <div className={styles.detailRow}>
              <Calendar size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Created</span>
                <span className={styles.detailValue}>
                  {new Date(task.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>

            <div className={styles.detailRow}>
              <Calendar size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Last Updated</span>
                <span className={styles.detailValue}>
                  {new Date(task.updatedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
