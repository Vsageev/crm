import { store } from '../db/index.js';

export interface ActivityEntry {
  id: string;
  type: 'note' | 'call' | 'meeting' | 'message' | 'deal' | 'task';
  title: string;
  description?: string | null;
  createdAt: string;
  meta?: Record<string, string>;
}

export interface ActivityListQuery {
  contactId: string;
  limit?: number;
  offset?: number;
}

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  email: 'Email',
  web_chat: 'Web Chat',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  other: 'Other',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'Received',
  outbound: 'Sent',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\u2026';
}

function toISOString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date(val as number).toISOString();
}

async function fetchMessageActivities(contactId: string): Promise<ActivityEntry[]> {
  // Find conversations for this contact
  const contactConversations = store.find('conversations', (r) => r.contactId === contactId);

  const entries: ActivityEntry[] = [];

  for (const conv of contactConversations) {
    const msgs = store.find('messages', (r) => r.conversationId === conv.id);

    for (const msg of msgs) {
      // Look up sender (left join equivalent)
      const sender = msg.senderId ? store.getById('users', msg.senderId as string) : null;

      const channel = CHANNEL_LABELS[conv.channelType as string] ?? (conv.channelType as string);
      const direction = DIRECTION_LABELS[msg.direction as string] ?? (msg.direction as string);

      const senderName = sender
        ? [sender.firstName, sender.lastName].filter(Boolean).join(' ')
        : null;

      const title =
        msg.direction === 'inbound'
          ? `${direction} message via ${channel}`
          : `${direction} message via ${channel}${senderName ? ` by ${senderName}` : ''}`;

      const description =
        msg.type === 'text' && msg.content
          ? truncate(msg.content as string, 200)
          : msg.type !== 'text'
            ? `[${msg.type}]`
            : null;

      const meta: Record<string, string> = {
        channel: conv.channelType as string,
        direction: msg.direction as string,
        conversationId: conv.id as string,
        messageType: (msg.type as string) ?? 'text',
      };

      if (msg.status) {
        meta.status = msg.status as string;
      }

      entries.push({
        id: msg.id as string,
        type: 'message' as const,
        title,
        description,
        createdAt: toISOString(msg.createdAt),
        meta,
      });
    }
  }

  // Sort by createdAt descending
  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return entries;
}

async function fetchActivityLogEntries(contactId: string): Promise<ActivityEntry[]> {
  const logs = store.find('activityLogs', (r) => r.contactId === contactId);

  const entries: ActivityEntry[] = logs.map((log) => {
    // Look up creator (left join equivalent)
    const creator = log.createdById ? store.getById('users', log.createdById as string) : null;

    const creatorName = creator
      ? [creator.firstName, creator.lastName].filter(Boolean).join(' ')
      : null;

    const meta: Record<string, string> = {};
    if (log.duration != null) {
      meta.duration = String(log.duration);
    }
    if (log.dealId) {
      meta.dealId = log.dealId as string;
    }
    if (creatorName) {
      meta.createdBy = creatorName;
    }
    if (log.meta) {
      Object.assign(meta, log.meta);
    }

    return {
      id: log.id as string,
      type: log.type as 'call' | 'meeting' | 'note',
      title: log.title as string,
      description: log.description ? truncate(log.description as string, 200) : null,
      createdAt: toISOString(log.occurredAt),
      meta,
    };
  });

  // Sort by occurredAt descending
  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return entries;
}

async function fetchTaskActivities(contactId: string): Promise<ActivityEntry[]> {
  const taskRows = store.find('tasks', (r) => r.contactId === contactId);

  const entries: ActivityEntry[] = taskRows.map((task) => {
    // Look up assignee (left join equivalent)
    const assignee = task.assigneeId ? store.getById('users', task.assigneeId as string) : null;

    const assigneeName = assignee
      ? [assignee.firstName, assignee.lastName].filter(Boolean).join(' ')
      : null;

    const status = TASK_STATUS_LABELS[task.status as string] ?? (task.status as string);
    const priority = TASK_PRIORITY_LABELS[task.priority as string] ?? (task.priority as string);

    const titleParts = [task.title as string];
    if (assigneeName) {
      titleParts.push(`\u2014 ${assigneeName}`);
    }

    const meta: Record<string, string> = {
      status: task.status as string,
      priority: task.priority as string,
      taskType: task.type as string,
    };
    if (task.dealId) {
      meta.dealId = task.dealId as string;
    }
    if (task.dueDate) {
      meta.dueDate = toISOString(task.dueDate);
    }
    if (task.isOverdue) {
      meta.isOverdue = 'true';
    }

    const descParts: string[] = [];
    descParts.push(`${status} \u00b7 ${priority} priority`);
    if (task.dueDate) {
      const dueDateObj = task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate as string);
      descParts.push(
        `Due ${dueDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      );
    }
    if (task.description) {
      descParts.push(truncate(task.description as string, 150));
    }

    return {
      id: task.id as string,
      type: 'task' as const,
      title: titleParts.join(' '),
      description: descParts.join(' \u00b7 '),
      createdAt: toISOString(task.createdAt),
      meta,
    };
  });

  // Sort by createdAt descending
  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return entries;
}

export async function listContactActivities(query: ActivityListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  // Fetch all activity sources in parallel
  const [messageEntries, activityLogEntries, taskEntries] = await Promise.all([
    fetchMessageActivities(query.contactId),
    fetchActivityLogEntries(query.contactId),
    fetchTaskActivities(query.contactId),
  ]);

  // Merge and sort all entries by date descending
  const allEntries = [...messageEntries, ...activityLogEntries, ...taskEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = allEntries.length;
  const items = allEntries.slice(offset, offset + limit);

  return { items, total };
}
