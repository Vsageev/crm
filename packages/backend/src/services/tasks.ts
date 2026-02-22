import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface TaskListQuery {
  assigneeId?: string;
  contactId?: string;
  dealId?: string;
  status?: string;
  priority?: string;
  type?: string;
  overdue?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateTaskData {
  title: string;
  description?: string;
  type?: 'call' | 'meeting' | 'email' | 'follow_up' | 'other';
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
  contactId?: string;
  dealId?: string;
  assigneeId?: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  type?: 'call' | 'meeting' | 'email' | 'follow_up' | 'other';
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  assigneeId?: string | null;
}

export async function listTasks(query: TaskListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: any) => {
    if (query.assigneeId && r.assigneeId !== query.assigneeId) return false;
    if (query.contactId && r.contactId !== query.contactId) return false;
    if (query.dealId && r.dealId !== query.dealId) return false;
    if (query.status && r.status !== query.status) return false;
    if (query.priority && r.priority !== query.priority) return false;
    if (query.type && r.type !== query.type) return false;
    if (query.overdue && !r.isOverdue) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      const match =
        r.title?.toLowerCase().includes(term) ||
        r.description?.toLowerCase().includes(term);
      if (!match) return false;
    }
    return true;
  };

  const all = store.find('tasks', predicate)
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const entries = all.slice(offset, offset + limit);
  const total = all.length;

  return { entries, total };
}

export async function getTaskById(id: string) {
  return store.getById('tasks', id) ?? null;
}

export async function createTask(
  data: CreateTaskData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const task = store.insert('tasks', {
    title: data.title,
    description: data.description,
    type: data.type,
    status: data.status,
    priority: data.priority,
    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    contactId: data.contactId,
    dealId: data.dealId,
    assigneeId: data.assigneeId,
    createdById: audit?.userId,
    isOverdue: data.dueDate ? new Date(data.dueDate) < new Date() : false,
  }) as any;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'task',
      entityId: task.id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return task;
}

export async function updateTask(
  id: string,
  data: UpdateTaskData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const setData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      if (key === 'dueDate') {
        setData[key] = value === null ? null : new Date(value as string);
      } else {
        setData[key] = value;
      }
    }
  }

  // Auto-set completedAt when status changes to completed
  if (data.status === 'completed') {
    setData.completedAt = new Date();
  } else if (data.status) {
    setData.completedAt = null;
  }

  // Update isOverdue based on dueDate
  if (data.dueDate !== undefined) {
    setData.isOverdue =
      data.dueDate === null ? false : new Date(data.dueDate) < new Date();
  }

  setData.updatedAt = new Date();

  const updated = store.update('tasks', id, setData) as any;

  if (!updated) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'task',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteTask(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('tasks', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'task',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}
