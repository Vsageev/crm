import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface TemplateListQuery {
  userId: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateTemplateData {
  name: string;
  content: string;
  category?: string;
  shortcut?: string;
  isGlobal?: boolean;
  createdBy: string;
}

export interface UpdateTemplateData {
  name?: string;
  content?: string;
  category?: string | null;
  shortcut?: string | null;
  isGlobal?: boolean;
}

export async function listTemplates(query: TemplateListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    // Must be global or created by the user
    if (r.isGlobal !== true && r.createdBy !== query.userId) return false;
    if (query.category && r.category !== query.category) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      const name = (r.name as string | undefined)?.toLowerCase() ?? '';
      const content = (r.content as string | undefined)?.toLowerCase() ?? '';
      if (!name.includes(term) && !content.includes(term)) return false;
    }
    return true;
  };

  const allMatching = store.find('quickReplyTemplates', predicate);
  const total = allMatching.length;

  const sorted = allMatching.sort(
    (a, b) =>
      new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime(),
  );

  const entries = sorted.slice(offset, offset + limit).map((template) => {
    const creator = template.createdBy
      ? store.getById('users', template.createdBy as string)
      : null;

    return {
      ...template,
      creator: creator
        ? {
            id: creator.id,
            firstName: creator.firstName,
            lastName: creator.lastName,
          }
        : null,
    };
  });

  return { entries, total };
}

export async function getTemplateById(id: string, userId: string) {
  const template = store.findOne('quickReplyTemplates', (r) => {
    if (r.id !== id) return false;
    if (r.isGlobal !== true && r.createdBy !== userId) return false;
    return true;
  });

  if (!template) return null;

  const creator = template.createdBy
    ? store.getById('users', template.createdBy as string)
    : null;

  return {
    ...template,
    creator: creator
      ? {
          id: creator.id,
          firstName: creator.firstName,
          lastName: creator.lastName,
        }
      : null,
  };
}

export async function createTemplate(
  data: CreateTemplateData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const template = store.insert('quickReplyTemplates', {
    name: data.name,
    content: data.content,
    category: data.category,
    shortcut: data.shortcut,
    isGlobal: data.isGlobal ?? false,
    createdBy: data.createdBy,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'quick_reply_template',
      entityId: template.id as string,
      changes: { name: data.name, isGlobal: data.isGlobal ?? false },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return template;
}

export async function updateTemplate(
  id: string,
  userId: string,
  userRole: string,
  data: UpdateTemplateData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // Only the creator or admin/manager can update
  const existing = store.getById('quickReplyTemplates', id);

  if (!existing) return null;

  if (existing.createdBy !== userId && userRole === 'agent') {
    return { forbidden: true as const };
  }

  const updated = store.update('quickReplyTemplates', id, {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.content !== undefined && { content: data.content }),
    ...(data.category !== undefined && { category: data.category ?? null }),
    ...(data.shortcut !== undefined && { shortcut: data.shortcut ?? null }),
    ...(data.isGlobal !== undefined && { isGlobal: data.isGlobal }),
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'quick_reply_template',
      entityId: id,
      changes: data as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteTemplate(
  id: string,
  userId: string,
  userRole: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const existing = store.getById('quickReplyTemplates', id);

  if (!existing) return null;

  if (existing.createdBy !== userId && userRole === 'agent') {
    return { forbidden: true as const };
  }

  store.delete('quickReplyTemplates', id);

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'quick_reply_template',
      entityId: id,
      changes: { name: existing.name as string },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return existing;
}
