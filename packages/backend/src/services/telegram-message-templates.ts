import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface TelegramTemplateListQuery {
  userId: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateTelegramTemplateData {
  name: string;
  content: string;
  parseMode?: string | null;
  inlineKeyboard?: unknown;
  category?: string;
  isGlobal?: boolean;
  createdBy: string;
}

export interface UpdateTelegramTemplateData {
  name?: string;
  content?: string;
  parseMode?: string | null;
  inlineKeyboard?: unknown;
  category?: string | null;
  isGlobal?: boolean;
}

export async function listTelegramTemplates(query: TelegramTemplateListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  // Filter templates: global or created by the user
  let entries = store.find('telegramMessageTemplates', r =>
    r.isGlobal === true || r.createdBy === query.userId,
  );

  if (query.category) {
    entries = entries.filter(r => r.category === query.category);
  }

  if (query.search) {
    const term = query.search.toLowerCase();
    entries = entries.filter(r =>
      (r.name as string)?.toLowerCase().includes(term) ||
      (r.content as string)?.toLowerCase().includes(term),
    );
  }

  const total = entries.length;

  // Sort by updatedAt descending
  entries.sort((a, b) =>
    new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime(),
  );

  // Apply pagination
  entries = entries.slice(offset, offset + limit);

  // Enrich with creator info
  const enriched = entries.map(template => {
    const creator = template.createdBy
      ? store.getById('users', template.createdBy as string)
      : null;
    return {
      ...template,
      creator: creator
        ? { id: creator.id, firstName: creator.firstName, lastName: creator.lastName }
        : null,
    };
  });

  return {
    entries: enriched,
    total,
  };
}

export async function getTelegramTemplateById(id: string, userId: string) {
  const template = store.getById('telegramMessageTemplates', id);
  if (!template) return null;

  // Check access: must be global or created by user
  if (template.isGlobal !== true && template.createdBy !== userId) return null;

  const creator = template.createdBy
    ? store.getById('users', template.createdBy as string)
    : null;

  return {
    ...template,
    creator: creator
      ? { id: creator.id, firstName: creator.firstName, lastName: creator.lastName }
      : null,
  };
}

export async function createTelegramTemplate(
  data: CreateTelegramTemplateData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const template = store.insert('telegramMessageTemplates', {
    name: data.name,
    content: data.content,
    parseMode: data.parseMode ?? null,
    inlineKeyboard: data.inlineKeyboard ?? null,
    category: data.category,
    isGlobal: data.isGlobal ?? false,
    createdBy: data.createdBy,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'telegram_message_template',
      entityId: template.id as string,
      changes: { name: data.name, isGlobal: data.isGlobal ?? false },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return template;
}

export async function updateTelegramTemplate(
  id: string,
  userId: string,
  userRole: string,
  data: UpdateTelegramTemplateData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const existing = store.getById('telegramMessageTemplates', id);
  if (!existing) return null;

  if (existing.createdBy !== userId && userRole === 'agent') {
    return { forbidden: true as const };
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.parseMode !== undefined) updateData.parseMode = data.parseMode;
  if (data.inlineKeyboard !== undefined) updateData.inlineKeyboard = data.inlineKeyboard;
  if (data.category !== undefined) updateData.category = data.category ?? null;
  if (data.isGlobal !== undefined) updateData.isGlobal = data.isGlobal;

  const updated = store.update('telegramMessageTemplates', id, updateData);

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'telegram_message_template',
      entityId: id,
      changes: data as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteTelegramTemplate(
  id: string,
  userId: string,
  userRole: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const existing = store.getById('telegramMessageTemplates', id);
  if (!existing) return null;

  if (existing.createdBy !== userId && userRole === 'agent') {
    return { forbidden: true as const };
  }

  store.delete('telegramMessageTemplates', id);

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'telegram_message_template',
      entityId: id,
      changes: { name: existing.name },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return existing;
}
