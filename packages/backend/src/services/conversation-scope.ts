import { store } from '../db/index.js';

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
}

/**
 * Agent chat is isolated from generic inbox APIs.
 * A conversation is treated as agent-scoped if it has channelType 'agent'
 * or carries an agentId in metadata (legacy 'other' rows).
 */
export function isAgentConversationRecord(conversation: Record<string, unknown>): boolean {
  if (conversation.channelType === 'agent') return true;
  const metadata = parseMetadata(conversation.metadata);
  return typeof metadata?.agentId === 'string' && metadata.agentId.length > 0;
}

export function getInboxConversationById(id: string): Record<string, unknown> | null {
  const conversation = store.getById('conversations', id);
  if (!conversation || isAgentConversationRecord(conversation)) return null;
  return conversation;
}

export function isInboxConversationId(id: string): boolean {
  return getInboxConversationById(id) !== null;
}
