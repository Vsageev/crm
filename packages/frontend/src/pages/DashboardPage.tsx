import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  Kanban,
  CheckSquare,
  MessageSquare,
  ArrowRight,
  Phone,
  Mail,
  FileText,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { PageHeader } from '../layout';
import { useAuth } from '../stores/useAuth';
import { api } from '../lib/api';
import styles from './DashboardPage.module.css';

interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  type: string;
}

interface ActivityItem {
  id: string;
  type: string;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--color-error)',
  high: 'var(--color-warning)',
  medium: 'var(--color-info)',
  low: 'var(--color-text-tertiary)',
};

const ACTIVITY_ICONS: Record<string, { icon: typeof Phone; bg: string; color: string }> = {
  call: { icon: Phone, bg: 'rgba(59,130,246,0.1)', color: 'var(--color-info)' },
  email: { icon: Mail, bg: 'rgba(139,92,246,0.1)', color: '#8B5CF6' },
  meeting: { icon: Calendar, bg: 'rgba(16,185,129,0.1)', color: 'var(--color-success)' },
  note: { icon: FileText, bg: 'rgba(245,158,11,0.1)', color: 'var(--color-warning)' },
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return date.toLocaleDateString();
}

function formatDueDate(dateStr: string): { text: string; overdue: boolean } {
  const due = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.floor((dueDay.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, overdue: true };
  if (diffDays === 0) return { text: 'Due today', overdue: false };
  if (diffDays === 1) return { text: 'Due tomorrow', overdue: false };
  if (diffDays < 7) return { text: `Due in ${diffDays}d`, overdue: false };
  return { text: due.toLocaleDateString(), overdue: false };
}

export function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ contacts: 0, deals: 0, tasks: 0, unread: 0 });
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [contactsRes, dealsRes, tasksRes, unreadRes, activityRes] =
        await Promise.all([
          api<{ total: number }>('/contacts?limit=0'),
          api<{ total: number }>('/deals?limit=0'),
          api<{ entries: TaskItem[]; total: number }>(
            '/tasks?status=pending&status=in_progress&limit=8',
          ),
          api<{ count: number }>('/notifications/unread-count'),
          api<{ entries: ActivityItem[] }>('/activity-logs?limit=8'),
        ]);

      setStats({
        contacts: contactsRes.total,
        deals: dealsRes.total,
        tasks: tasksRes.total,
        unread: unreadRes.count,
      });
      setTasks(tasksRes.entries);
      setActivities(activityRes.entries);
    } catch {
      // silently handle — dashboard is best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const greeting = user ? `Welcome back, ${user.firstName}` : 'Dashboard';

  return (
    <div className={styles.wrapper}>
      <PageHeader title={greeting} description="Overview of your CRM activity" />

      {loading ? (
        <div className={styles.loadingState}>Loading dashboard...</div>
      ) : (
        <>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div
                className={styles.statIcon}
                style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--color-info)' }}
              >
                <Users size={20} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.contacts}</div>
                <div className={styles.statLabel}>Contacts</div>
              </div>
            </div>
            <div className={styles.statCard}>
              <div
                className={styles.statIcon}
                style={{ background: 'rgba(139,92,246,0.1)', color: '#8B5CF6' }}
              >
                <Kanban size={20} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.deals}</div>
                <div className={styles.statLabel}>Deals</div>
              </div>
            </div>
            <div className={styles.statCard}>
              <div
                className={styles.statIcon}
                style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--color-warning)' }}
              >
                <CheckSquare size={20} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.tasks}</div>
                <div className={styles.statLabel}>Open Tasks</div>
              </div>
            </div>
            <div className={styles.statCard}>
              <div
                className={styles.statIcon}
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--color-error)' }}
              >
                <MessageSquare size={20} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>{stats.unread}</div>
                <div className={styles.statLabel}>Unread Notifications</div>
              </div>
            </div>
          </div>

          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Open Tasks</h2>
                <Link to="/tasks" className={styles.viewAllLink}>
                  View all <ArrowRight size={14} />
                </Link>
              </div>
              {tasks.length === 0 ? (
                <div className={styles.emptyState}>No open tasks</div>
              ) : (
                <div className={styles.taskList}>
                  {tasks.map((task) => {
                    const due = task.dueDate ? formatDueDate(task.dueDate) : null;
                    return (
                      <Link
                        key={task.id}
                        to={`/tasks/${task.id}`}
                        className={styles.taskItem}
                      >
                        <span
                          className={styles.taskPriority}
                          style={{
                            backgroundColor: PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.low,
                          }}
                        />
                        <div className={styles.taskInfo}>
                          <div className={styles.taskTitle}>{task.title}</div>
                          {due && (
                            <div
                              className={`${styles.taskDue} ${due.overdue ? styles.taskDueOverdue : ''}`}
                            >
                              {due.overdue && <AlertCircle size={11} style={{ marginRight: 3, verticalAlign: -1 }} />}
                              {due.text}
                            </div>
                          )}
                        </div>
                        <span className={styles.taskStatus}>{task.status}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Recent Activity</h2>
              </div>
              {activities.length === 0 ? (
                <div className={styles.emptyState}>No recent activity</div>
              ) : (
                <div className={styles.activityList}>
                  {activities.map((activity) => {
                    const config = ACTIVITY_ICONS[activity.type] ?? ACTIVITY_ICONS.note;
                    const Icon = config.icon;
                    const contactName = activity.contact
                      ? `${activity.contact.firstName} ${activity.contact.lastName}`
                      : 'Unknown contact';
                    const actorName = activity.createdBy
                      ? `${activity.createdBy.firstName} ${activity.createdBy.lastName}`
                      : 'System';

                    return (
                      <div key={activity.id} className={styles.activityItem}>
                        <div
                          className={styles.activityIcon}
                          style={{ background: config.bg, color: config.color }}
                        >
                          <Icon size={14} />
                        </div>
                        <div className={styles.activityContent}>
                          <div className={styles.activityText}>
                            <strong>{actorName}</strong> logged a {activity.type} with{' '}
                            <strong>{contactName}</strong>
                            {activity.notes && ` — ${activity.notes}`}
                          </div>
                          <div className={styles.activityTime}>
                            {formatRelativeTime(activity.createdAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
