import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  List,
  CalendarDays,
  Clock,
  CheckCircle2,
  Circle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { TasksCalendarView } from './TasksCalendarView';
import styles from './TasksListPage.module.css';

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

interface TasksResponse {
  total: number;
  limit: number;
  offset: number;
  entries: Task[];
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
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

const PAGE_SIZE = 25;

export function TasksListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');

  const page = parseInt(searchParams.get('page') || '1', 10);
  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status') || '';
  const priorityFilter = searchParams.get('priority') || '';
  const typeFilter = searchParams.get('type') || '';
  const view = searchParams.get('view') || 'list';

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (typeFilter) params.set('type', typeFilter);

      const data = await api<TasksResponse>(`/tasks?${params}`);
      setTasks(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load tasks');
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, priorityFilter, typeFilter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (searchInput) {
        next.set('search', searchInput);
      } else {
        next.delete('search');
      }
      next.set('page', '1');
      return next;
    });
  }

  function goToPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  }

  function setFilter(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.set('page', '1');
      return next;
    });
  }

  function setView(v: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === 'list') {
        next.delete('view');
      } else {
        next.set('view', v);
      }
      return next;
    });
  }

  function formatDueDate(dueDate: string | null | undefined, isOverdue: boolean) {
    if (!dueDate) return <span className={styles.empty}>—</span>;
    const date = new Date(dueDate);
    const formatted = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
    if (isOverdue) {
      return (
        <span className={styles.overdue}>
          <AlertTriangle size={13} />
          {formatted}
        </span>
      );
    }
    return formatted;
  }

  async function handleQuickStatusToggle(task: Task, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const newStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await api(`/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status: newStatus, completedAt: newStatus === 'completed' ? new Date().toISOString() : null }
            : t,
        ),
      );
    } catch {
      // Silently fail — user can retry
    }
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Track your tasks and activities"
        actions={
          <Link to="/tasks/new">
            <Button size="md">
              <Plus size={16} />
              Add Task
            </Button>
          </Link>
        }
      />

      <Card>
        <div className={styles.toolbar}>
          <form onSubmit={handleSearch} className={styles.searchForm}>
            <div className={styles.searchInputWrap}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search tasks..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>

          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewBtn} ${view === 'list' ? styles.viewBtnActive : ''}`}
              onClick={() => setView('list')}
              title="List view"
            >
              <List size={16} />
            </button>
            <button
              className={`${styles.viewBtn} ${view === 'calendar' ? styles.viewBtnActive : ''}`}
              onClick={() => setView('calendar')}
              title="Calendar view"
            >
              <CalendarDays size={16} />
            </button>
          </div>
        </div>

        <div className={styles.filters}>
          <select
            value={statusFilter}
            onChange={(e) => setFilter('status', e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setFilter('priority', e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setFilter('type', e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Types</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="email">Email</option>
            <option value="follow_up">Follow Up</option>
            <option value="other">Other</option>
          </select>

          <div className={styles.meta}>
            {!loading && (
              <span className={styles.count}>
                {total} task{total !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {error && <div className={styles.alert}>{error}</div>}

        {view === 'calendar' ? (
          <TasksCalendarView tasks={tasks} loading={loading} />
        ) : loading ? (
          <div className={styles.emptyState}>Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className={styles.emptyState}>
            {search || statusFilter || priorityFilter || typeFilter ? (
              <>
                <p>No tasks match your filters.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchInput('');
                    setSearchParams({});
                  }}
                >
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <p>No tasks yet.</p>
                <Link to="/tasks/new">
                  <Button size="sm">
                    <Plus size={14} />
                    Create your first task
                  </Button>
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.checkCol}></th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const StatusIcon = STATUS_ICONS[task.status];
                    return (
                      <tr
                        key={task.id}
                        className={task.status === 'completed' ? styles.completedRow : undefined}
                      >
                        <td className={styles.checkCol}>
                          <button
                            className={`${styles.checkBtn} ${task.status === 'completed' ? styles.checkBtnDone : ''}`}
                            onClick={(e) => handleQuickStatusToggle(task, e)}
                            title={task.status === 'completed' ? 'Mark as pending' : 'Mark as completed'}
                          >
                            {task.status === 'completed' ? (
                              <CheckCircle2 size={18} />
                            ) : (
                              <Circle size={18} />
                            )}
                          </button>
                        </td>
                        <td>
                          <Link to={`/tasks/${task.id}`} className={styles.titleCell}>
                            {task.title}
                          </Link>
                        </td>
                        <td>
                          <span className={styles.typeLabel}>{TYPE_LABELS[task.type]}</span>
                        </td>
                        <td>
                          <Badge color={PRIORITY_COLORS[task.priority]}>
                            {PRIORITY_LABELS[task.priority]}
                          </Badge>
                        </td>
                        <td>
                          <span className={styles.statusCell}>
                            <StatusIcon size={14} />
                            {STATUS_LABELS[task.status]}
                          </span>
                        </td>
                        <td className={styles.dateCell}>
                          {formatDueDate(task.dueDate, task.isOverdue)}
                        </td>
                        <td className={styles.dateCell}>
                          {new Date(task.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  <ChevronLeft size={14} />
                  Previous
                </Button>
                <span className={styles.pageInfo}>
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                  <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
