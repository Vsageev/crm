import { useCallback, useEffect, useState } from 'react';
import {
  MessageSquare,
  Phone,
  Calendar,
  StickyNote,
  Handshake,
  CheckSquare,
  Clock,
  Inbox,
} from 'lucide-react';
import { Badge } from '../../ui';
import { api } from '../../lib/api';
import styles from './ActivityTimeline.module.css';

export type ActivityType = 'note' | 'call' | 'meeting' | 'message' | 'deal' | 'task';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  title: string;
  description?: string | null;
  createdAt: string;
  meta?: Record<string, string>;
}

interface ActivityTimelineProps {
  contactId: string;
}

const TYPE_CONFIG: Record<ActivityType, { icon: typeof MessageSquare; label: string; color: string }> = {
  note: { icon: StickyNote, label: 'Note', color: 'var(--color-warning)' },
  call: { icon: Phone, label: 'Call', color: 'var(--color-success)' },
  meeting: { icon: Calendar, label: 'Meeting', color: 'var(--color-info)' },
  message: { icon: MessageSquare, label: 'Message', color: 'var(--color-link)' },
  deal: { icon: Handshake, label: 'Deal', color: 'var(--color-info-purple, #8b5cf6)' },
  task: { icon: CheckSquare, label: 'Task', color: 'var(--color-success)' },
};

const TYPE_BADGE_COLOR: Record<ActivityType, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  note: 'warning',
  call: 'success',
  meeting: 'info',
  message: 'info',
  deal: 'default',
  task: 'success',
};

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function groupByDate(entries: ActivityEntry[]): Map<string, ActivityEntry[]> {
  const groups = new Map<string, ActivityEntry[]>();

  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);

    let key: string;
    if (diffDays === 0) {
      key = 'Today';
    } else if (diffDays === 1) {
      key = 'Yesterday';
    } else if (diffDays < 7) {
      key = 'This Week';
    } else if (diffDays < 30) {
      key = 'This Month';
    } else {
      key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  return groups;
}

export function ActivityTimeline({ contactId }: ActivityTimelineProps) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ items: ActivityEntry[] }>(
        `/contacts/${contactId}/activities`,
      );
      setActivities(data.items);
    } catch {
      // API not yet available — show empty state
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  if (loading) {
    return (
      <div className={styles.container}>
        <h3 className={styles.heading}>Activity</h3>
        <div className={styles.emptyState}>
          <Clock size={20} className={styles.emptyIcon} />
          <span>Loading activity...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h3 className={styles.heading}>Activity</h3>
        <div className={styles.emptyState}>
          <span className={styles.errorText}>{error}</span>
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className={styles.container}>
        <h3 className={styles.heading}>Activity</h3>
        <div className={styles.emptyState}>
          <Inbox size={32} className={styles.emptyIcon} />
          <span className={styles.emptyTitle}>No activity yet</span>
          <span className={styles.emptyDescription}>
            Activity from messages, calls, notes, tasks, and deals will appear here.
          </span>
        </div>
      </div>
    );
  }

  const grouped = groupByDate(activities);

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>Activity</h3>

      <div className={styles.timeline}>
        {[...grouped.entries()].map(([dateLabel, entries]) => (
          <div key={dateLabel} className={styles.group}>
            <div className={styles.groupLabel}>{dateLabel}</div>

            {entries.map((entry) => {
              const config = TYPE_CONFIG[entry.type];
              const Icon = config.icon;

              return (
                <div key={entry.id} className={styles.entry}>
                  <div className={styles.entryLine}>
                    <div
                      className={styles.entryDot}
                      style={{ background: config.color }}
                    >
                      <Icon size={12} color="#fff" />
                    </div>
                  </div>

                  <div className={styles.entryContent}>
                    <div className={styles.entryHeader}>
                      <Badge color={TYPE_BADGE_COLOR[entry.type]}>
                        {config.label}
                      </Badge>
                      <span className={styles.entryTime}>
                        {formatRelativeDate(entry.createdAt)}
                      </span>
                    </div>
                    <p className={styles.entryTitle}>{entry.title}</p>
                    {entry.description && (
                      <p className={styles.entryDescription}>{entry.description}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
