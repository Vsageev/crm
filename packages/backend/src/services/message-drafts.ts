import { store } from '../db/index.js';
import { isAgentConversationRecord } from './conversation-scope.js';

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
  const conversationScopeCache = new Map<string, boolean>();

  const isInboxConversation = (conversationId: string): boolean => {
    const cached = conversationScopeCache.get(conversationId);
    if (cached !== undefined) return cached;
    const conversation = store.getById('conversations', conversationId);
    const isInbox = Boolean(conversation && !isAgentConversationRecord(conversation));
    conversationScopeCache.set(conversationId, isInbox);
    return isInbox;
  };

  const predicate = (r: Record<string, unknown>) => {
    const conversationId = r.conversationId as string | undefined;
    if (!conversationId || !isInboxConversation(conversationId)) return false;
    if (query.conversationId && conversationId !== query.conversationId) return false;
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
  const draft = store.getById('messageDrafts', id);
  if (!draft) return null;
  const conversation = store.getById('conversations', draft.conversationId as string);
  if (!conversation || isAgentConversationRecord(conversation)) return null;
  return draft;
}

export async function upsertDraft(data: UpsertDraftData) {
  const conversation = store.getById('conversations', data.conversationId);
  if (!conversation || isAgentConversationRecord(conversation)) return null;

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
  const draft = store.getById('messageDrafts', id);
  if (!draft) return false;
  const conversation = store.getById('conversations', draft.conversationId as string);
  if (!conversation || isAgentConversationRecord(conversation)) return false;
  return store.delete('messageDrafts', id);
}

export async function deleteDraftByConversationId(conversationId: string) {
  const conversation = store.getById('conversations', conversationId);
  if (!conversation || isAgentConversationRecord(conversation)) return false;

  const deleted = store.deleteWhere(
    'messageDrafts',
    (r: any) => r.conversationId === conversationId,
  );
  return deleted.length > 0;
}
