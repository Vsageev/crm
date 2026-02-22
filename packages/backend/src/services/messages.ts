import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface MessageListQuery {
  conversationId: string;
  limit?: number;
  offset?: number;
}

export interface SendMessageData {
  conversationId: string;
  senderId?: string;
  direction: 'inbound' | 'outbound';
  type?: 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker' | 'location' | 'system';
  content?: string;
  externalId?: string;
  attachments?: unknown;
  metadata?: string;
}

export async function listMessages(query: MessageListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const allMatching = store.find(
    'messages',
    (r) => r.conversationId === query.conversationId,
  );
  const total = allMatching.length;

  const sorted = allMatching.sort(
    (a, b) =>
      new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime(),
  );

  const entries = sorted.slice(offset, offset + limit).map((message) => {
    const sender = message.senderId
      ? store.getById('users', message.senderId as string)
      : null;

    return {
      ...message,
      sender: sender
        ? {
            id: sender.id,
            firstName: sender.firstName,
            lastName: sender.lastName,
          }
        : null,
    };
  });

  return { entries, total };
}

export async function getMessageById(id: string) {
  const message = store.getById('messages', id);
  if (!message) return null;

  const sender = message.senderId
    ? store.getById('users', message.senderId as string)
    : null;

  return {
    ...message,
    sender: sender
      ? {
          id: sender.id,
          firstName: sender.firstName,
          lastName: sender.lastName,
        }
      : null,
  };
}

export async function sendMessage(
  data: SendMessageData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // Verify conversation exists
  const conversation = store.getById('conversations', data.conversationId);
  if (!conversation) return null;

  const message = store.insert('messages', {
    conversationId: data.conversationId,
    senderId: data.senderId,
    direction: data.direction,
    type: data.type ?? 'text',
    content: data.content,
    status: data.direction === 'outbound' ? 'sent' : 'delivered',
    externalId: data.externalId,
    attachments: data.attachments,
    metadata: data.metadata,
  });

  // Update conversation's lastMessageAt and mark unread for inbound
  store.update('conversations', data.conversationId, {
    lastMessageAt: new Date(),
    isUnread: data.direction === 'inbound',
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'message',
      entityId: message.id as string,
      changes: {
        conversationId: data.conversationId,
        direction: data.direction,
        type: data.type ?? 'text',
      },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return message;
}

export async function updateMessageStatus(
  id: string,
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed',
) {
  const updated = store.update('messages', id, { status });
  return updated ?? null;
}
