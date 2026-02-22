import { store } from '../db/index.js';

type NotificationType = string;

export interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
}

export interface NotificationListQuery {
  userId: string;
  type?: NotificationType;
  isRead?: boolean;
  limit?: number;
  offset?: number;
}

export async function createNotification(data: CreateNotificationData) {
  const entry = store.insert('notifications', {
    userId: data.userId,
    type: data.type,
    title: data.title,
    message: data.message,
    entityType: data.entityType,
    entityId: data.entityId,
    isRead: false,
  });

  return entry;
}

export async function createNotificationsBatch(items: CreateNotificationData[]) {
  if (items.length === 0) return [];

  const entries = store.insertMany(
    'notifications',
    items.map((data) => ({
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      entityType: data.entityType,
      entityId: data.entityId,
      isRead: false,
    })),
  );

  return entries;
}

export async function listNotifications(query: NotificationListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (r.userId !== query.userId) return false;
    if (query.type && r.type !== query.type) return false;
    if (query.isRead !== undefined && r.isRead !== query.isRead) return false;
    return true;
  };

  const allMatching = store.find('notifications', predicate);
  const total = allMatching.length;

  const sorted = allMatching.sort(
    (a, b) =>
      new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime(),
  );

  const entries = sorted.slice(offset, offset + limit);

  return { entries, total };
}

export async function getNotificationById(id: string) {
  return store.getById('notifications', id) ?? null;
}

export async function markAsRead(id: string, userId: string) {
  const existing = store.findOne(
    'notifications',
    (r) => r.id === id && r.userId === userId,
  );
  if (!existing) return null;

  const updated = store.update('notifications', id, { isRead: true, readAt: new Date() });
  return updated ?? null;
}

export async function markAllAsRead(userId: string) {
  const unread = store.find(
    'notifications',
    (r) => r.userId === userId && r.isRead === false,
  );

  const updated = unread.map((n) =>
    store.update('notifications', n.id as string, { isRead: true, readAt: new Date() }),
  ).filter(Boolean);

  return updated;
}

export async function getUnreadCount(userId: string) {
  return store.count(
    'notifications',
    (r) => r.userId === userId && r.isRead === false,
  );
}

export async function deleteNotification(id: string, userId: string) {
  const existing = store.findOne(
    'notifications',
    (r) => r.id === id && r.userId === userId,
  );
  if (!existing) return null;

  const deleted = store.delete('notifications', id);
  return deleted ?? null;
}

/**
 * Finds tasks that are due within the given number of hours
 * and haven't been completed or cancelled.
 * Used by the reminder scheduler to generate due-soon notifications.
 */
export async function findTasksDueSoon(withinHours: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinHours * 60 * 60 * 1000);

  const dueTasks = store.find('tasks', (r) => {
    if (r.status === 'completed' || r.status === 'cancelled') return false;
    if (r.completedAt != null) return false;
    const dueDate = new Date(r.dueDate as string);
    return dueDate >= now && dueDate <= cutoff;
  });

  return dueTasks;
}

/**
 * Finds tasks that are overdue (past due date)
 * and haven't been completed or cancelled.
 */
export async function findOverdueTasks() {
  const now = new Date();

  const overdueTasks = store.find('tasks', (r) => {
    if (r.status === 'completed' || r.status === 'cancelled') return false;
    if (r.completedAt != null) return false;
    const dueDate = new Date(r.dueDate as string);
    return dueDate <= now;
  });

  return overdueTasks;
}

/**
 * Checks if a notification already exists for a given entity to avoid duplicates.
 */
export async function hasRecentNotification(
  userId: string,
  type: NotificationType,
  entityId: string,
  withinHours: number,
) {
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);

  const count = store.count('notifications', (r) => {
    if (r.userId !== userId) return false;
    if (r.type !== type) return false;
    if (r.entityId !== entityId) return false;
    const createdAt = new Date(r.createdAt as string);
    return createdAt >= cutoff;
  });

  return count > 0;
}
