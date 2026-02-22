import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';
import { createConversation } from './conversations.js';
import { sendMessage, type SendMessageData } from './messages.js';
import { createContact } from './contacts.js';
import { eventBus } from './event-bus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateWebChatWidgetData {
  name: string;
  welcomeMessage?: string;
  placeholderText?: string;
  brandColor?: string;
  position?: string;
  autoGreetingEnabled?: boolean;
  autoGreetingDelaySec?: string;
  requireEmail?: boolean;
  requireName?: boolean;
  allowedOrigins?: string;
}

export interface UpdateWebChatWidgetData {
  name?: string;
  welcomeMessage?: string;
  placeholderText?: string;
  brandColor?: string;
  position?: string;
  autoGreetingEnabled?: boolean;
  autoGreetingDelaySec?: string;
  requireEmail?: boolean;
  requireName?: boolean;
  allowedOrigins?: string;
  status?: 'active' | 'inactive';
}

// ---------------------------------------------------------------------------
// Widget CRUD
// ---------------------------------------------------------------------------

export async function createWebChatWidget(
  data: CreateWebChatWidgetData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const widget = store.insert('webChatWidgets', {
    ...data,
    createdById: audit?.userId,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'web_chat_widget',
      entityId: widget.id as string,
      changes: { name: data.name },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return widget;
}

export async function updateWebChatWidget(
  id: string,
  data: UpdateWebChatWidgetData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date();

  const updated = store.update('webChatWidgets', id, setData);

  if (!updated) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'web_chat_widget',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteWebChatWidget(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('webChatWidgets', id);

  if (!deleted) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'web_chat_widget',
      entityId: id,
      changes: { name: deleted.name },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted;
}

export async function listWebChatWidgets() {
  const widgets = store.getAll('webChatWidgets');
  return widgets.sort(
    (a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime(),
  );
}

export async function getWebChatWidgetById(id: string) {
  return store.getById('webChatWidgets', id);
}

// ---------------------------------------------------------------------------
// Public widget config (no sensitive data)
// ---------------------------------------------------------------------------

export async function getPublicWidgetConfig(id: string) {
  const widget = await getWebChatWidgetById(id);
  if (!widget || widget.status !== 'active') return null;

  return {
    id: widget.id,
    name: widget.name,
    welcomeMessage: widget.welcomeMessage,
    placeholderText: widget.placeholderText,
    brandColor: widget.brandColor,
    position: widget.position,
    autoGreetingEnabled: widget.autoGreetingEnabled,
    autoGreetingDelaySec: Number(widget.autoGreetingDelaySec),
    requireEmail: widget.requireEmail,
    requireName: widget.requireName,
  };
}

// ---------------------------------------------------------------------------
// Visitor session management
// ---------------------------------------------------------------------------

/**
 * Find or create a conversation for a web chat visitor.
 * Uses a session ID stored in the visitor's browser to maintain continuity.
 */
export async function findOrCreateVisitorConversation(
  widgetId: string,
  sessionId: string,
  visitorInfo?: { name?: string; email?: string },
) {
  // Look for an existing open conversation with this session ID
  const existing = store.findOne('conversations', (r) =>
    r.channelType === 'web_chat' &&
    r.externalId === sessionId,
  );

  if (existing) {
    return { conversation: existing, isNew: false };
  }

  // Create a new contact for this visitor
  const contact = await createContact({
    firstName: visitorInfo?.name || 'Website Visitor',
    email: visitorInfo?.email,
    source: 'web_chat' as 'other',
    notes: `Web chat visitor (widget: ${widgetId})`,
  });

  eventBus.emit('contact_created', {
    contactId: contact.id,
    contact: contact as unknown as Record<string, unknown>,
  });

  // Create a conversation for this visitor
  const conversation = await createConversation({
    contactId: contact.id,
    channelType: 'web_chat',
    externalId: sessionId,
    status: 'open',
    subject: 'Web Chat',
    metadata: JSON.stringify({ widgetId }),
  });

  eventBus.emit('conversation_created', {
    conversationId: conversation.id as string,
    contactId: contact.id as string,
    conversation: conversation as unknown as Record<string, unknown>,
    contact: contact as unknown as Record<string, unknown>,
  });

  return { conversation, isNew: true };
}

// ---------------------------------------------------------------------------
// Message handling for web chat
// ---------------------------------------------------------------------------

/**
 * Handle an inbound message from a web chat visitor.
 */
export async function handleVisitorMessage(
  widgetId: string,
  sessionId: string,
  content: string,
  visitorInfo?: { name?: string; email?: string },
) {
  const widget = await getWebChatWidgetById(widgetId);
  if (!widget || widget.status !== 'active') {
    return { ok: false, error: 'Widget not found or inactive' };
  }

  const { conversation, isNew } = await findOrCreateVisitorConversation(
    widgetId,
    sessionId,
    visitorInfo,
  );

  // Store the visitor message
  const messageData: SendMessageData = {
    conversationId: conversation.id as string,
    direction: 'inbound',
    type: 'text',
    content,
    metadata: JSON.stringify({
      widgetId,
      sessionId,
      web_chat: true,
    }),
  };

  const message = await sendMessage(messageData);
  if (!message) {
    return { ok: false, error: 'Failed to store message' };
  }

  // Emit event for automation engine
  eventBus.emit('message_received', {
    messageId: message.id as string,
    conversationId: conversation.id as string,
    contactId: conversation.contactId as string,
    message: message as unknown as Record<string, unknown>,
    conversation: conversation as unknown as Record<string, unknown>,
  });

  // Reopen conversation if it was closed
  if (conversation.status === 'closed' || conversation.status === 'archived') {
    store.update('conversations', conversation.id as string, {
      status: 'open',
      closedAt: null,
      updatedAt: new Date(),
    });
  }

  // Send auto-greeting for new conversations
  if (isNew && widget.autoGreetingEnabled && widget.welcomeMessage) {
    const greetingMessage = await sendMessage({
      conversationId: conversation.id as string,
      direction: 'outbound',
      type: 'text',
      content: widget.welcomeMessage as string,
      metadata: JSON.stringify({ autoGreeting: true, widgetId }),
    });

    return {
      ok: true,
      messageId: message.id,
      conversationId: conversation.id,
      greeting: greetingMessage
        ? {
            id: greetingMessage.id,
            content: greetingMessage.content,
            createdAt: greetingMessage.createdAt,
          }
        : undefined,
    };
  }

  return {
    ok: true,
    messageId: message.id,
    conversationId: conversation.id,
  };
}

/**
 * Fetch messages for a web chat session (public, for the widget).
 * Returns only messages for the given session ID.
 */
export async function getVisitorMessages(sessionId: string) {
  const conversation = store.findOne('conversations', (r) =>
    r.channelType === 'web_chat' &&
    r.externalId === sessionId,
  );

  if (!conversation) {
    return { entries: [], conversationId: null };
  }

  const entries = store.find('messages', (r) => r.conversationId === conversation.id)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime())
    .slice(0, 100);

  return {
    entries: entries.reverse(),
    conversationId: conversation.id,
  };
}
