import { store } from '../db/index.js';

export interface DraftListQuery {
  conversationId?: string;
  limit?: number;
  offset?: number;
}

export interface UpsertDraftData {
  conversationId: string;
  content: string;
  attachments?: unknown;
  metadata?: string;
}

export async function listDrafts(query: DraftListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (query.conversationId && r.conversationId !== query.conversationId) return false;
    return true;
  };

  const allMatching = store.find('messageDrafts', predicate);
  const total = allMatching.length;

  const sorted = allMatching.sort(
    (a, b) =>
      new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime(),
  );

  const entries = sorted.slice(offset, offset + limit);
  return { entries, total };
}

export async function getDraftById(id: string) {
  return store.getById('messageDrafts', id);
}

export async function upsertDraft(data: UpsertDraftData) {
  const existing = store.findOne(
    'messageDrafts',
    (r) => r.conversationId === data.conversationId,
  );

  if (existing) {
    const updated = store.update('messageDrafts', existing.id as string, {
      content: data.content,
      attachments: data.attachments ?? null,
      metadata: data.metadata ?? null,
    });
    return updated;
  }

  return store.insert('messageDrafts', {
    conversationId: data.conversationId,
    content: data.content,
    attachments: data.attachments ?? null,
    metadata: data.metadata ?? null,
  });
}

export async function deleteDraft(id: string) {
  return store.delete('messageDrafts', id);
}

export async function deleteDraftByConversationId(conversationId: string) {
  const deleted = store.deleteWhere(
    'messageDrafts',
    (r: any) => r.conversationId === conversationId,
  );
  return deleted.length > 0;
}
