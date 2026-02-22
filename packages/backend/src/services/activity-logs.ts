import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface ActivityLogListQuery {
  contactId?: string;
  dealId?: string;
  type?: string;
  createdById?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateActivityLogData {
  type: 'call' | 'meeting' | 'note';
  title: string;
  description?: string;
  contactId?: string;
  dealId?: string;
  duration?: number;
  occurredAt?: string;
  meta?: Record<string, string>;
}

export interface UpdateActivityLogData {
  type?: 'call' | 'meeting' | 'note';
  title?: string;
  description?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  duration?: number | null;
  occurredAt?: string;
  meta?: Record<string, string> | null;
}

export async function listActivityLogs(query: ActivityLogListQuery) {
  const predicate = (r: Record<string, unknown>) => {
    if (query.contactId && r.contactId !== query.contactId) return false;
    if (query.dealId && r.dealId !== query.dealId) return false;
    if (query.createdById && r.createdById !== query.createdById) return false;
    if (query.type && r.type !== query.type) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      const title = (r.title as string | undefined)?.toLowerCase() ?? '';
      const description = (r.description as string | undefined)?.toLowerCase() ?? '';
      if (!title.includes(term) && !description.includes(term)) return false;
    }
    return true;
  };

  const allMatching = store.find('activityLogs', predicate);
  const total = allMatching.length;

  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const sorted = allMatching.sort(
    (a, b) =>
      new Date(b.occurredAt as string).getTime() - new Date(a.occurredAt as string).getTime(),
  );

  const entries = sorted.slice(offset, offset + limit);

  return { entries, total };
}

export async function getActivityLogById(id: string) {
  return store.getById('activityLogs', id) ?? null;
}

export async function createActivityLog(
  data: CreateActivityLogData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const entry = store.insert('activityLogs', {
    type: data.type,
    title: data.title,
    description: data.description,
    contactId: data.contactId,
    dealId: data.dealId,
    duration: data.duration,
    occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
    createdById: audit?.userId,
    meta: data.meta,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'activity_log',
      entityId: entry.id as string,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return entry;
}

export async function updateActivityLog(
  id: string,
  data: UpdateActivityLogData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const setData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      if (key === 'occurredAt') {
        setData[key] = new Date(value as string);
      } else {
        setData[key] = value;
      }
    }
  }

  const updated = store.update('activityLogs', id, setData);

  if (!updated) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'activity_log',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteActivityLog(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('activityLogs', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'activity_log',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}
