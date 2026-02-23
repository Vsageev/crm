import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface KBListQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateKBEntryData {
  title: string;
  content: string;
  createdBy: string;
}

export interface UpdateKBEntryData {
  title?: string;
  content?: string;
}

export async function listKBEntries(query: KBListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (query.search) {
      const term = query.search.toLowerCase();
      const title = (r.title as string | undefined)?.toLowerCase() ?? '';
      const content = (r.content as string | undefined)?.toLowerCase() ?? '';
      if (!title.includes(term) && !content.includes(term)) return false;
    }
    return true;
  };

  const allMatching = store.find('knowledgeBaseEntries', predicate);
  const total = allMatching.length;

  const sorted = allMatching.sort(
    (a, b) =>
      new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime(),
  );

  const entries = sorted.slice(offset, offset + limit);

  return { entries, total };
}

export function getAllKBEntries(): Record<string, unknown>[] {
  return store.find('knowledgeBaseEntries', () => true);
}

export async function getKBEntryById(id: string) {
  return store.getById('knowledgeBaseEntries', id) ?? null;
}

export async function createKBEntry(
  data: CreateKBEntryData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const entry = store.insert('knowledgeBaseEntries', {
    title: data.title,
    content: data.content,
    createdBy: data.createdBy,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'knowledge_base_entry',
      entityId: entry.id as string,
      changes: { title: data.title },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return entry;
}

export async function updateKBEntry(
  id: string,
  data: UpdateKBEntryData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const existing = store.getById('knowledgeBaseEntries', id);
  if (!existing) return null;

  const updated = store.update('knowledgeBaseEntries', id, {
    ...(data.title !== undefined && { title: data.title }),
    ...(data.content !== undefined && { content: data.content }),
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'knowledge_base_entry',
      entityId: id,
      changes: data as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteKBEntry(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const existing = store.getById('knowledgeBaseEntries', id);
  if (!existing) return null;

  store.delete('knowledgeBaseEntries', id);

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'knowledge_base_entry',
      entityId: id,
      changes: { title: existing.title as string },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return existing;
}
