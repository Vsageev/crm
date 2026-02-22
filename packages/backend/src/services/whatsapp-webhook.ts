import { store } from '../db/index.js';
import { getAccountByPhoneNumberId } from './whatsapp.js';
import { createConversation } from './conversations.js';
import { sendMessage, type SendMessageData } from './messages.js';
import { createContact, getContactByWhatsAppPhoneId, getContactTagNames } from './contacts.js';
import { sendWhatsAppMessage } from './whatsapp-outbound.js';
import { eventBus } from './event-bus.js';

// ---------------------------------------------------------------------------
// WhatsApp Cloud API webhook payload types
// ---------------------------------------------------------------------------

interface WhatsAppProfile {
  name: string;
}

interface WhatsAppContact {
  profile: WhatsAppProfile;
  wa_id: string;
}

interface WhatsAppTextMessage {
  body: string;
}

interface WhatsAppImageMessage {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
}

interface WhatsAppVideoMessage {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
}

interface WhatsAppDocumentMessage {
  id: string;
  mime_type: string;
  sha256: string;
  filename?: string;
  caption?: string;
}

interface WhatsAppAudioMessage {
  id: string;
  mime_type: string;
  sha256: string;
  voice?: boolean;
}

interface WhatsAppLocationMessage {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

interface WhatsAppStickerMessage {
  id: string;
  mime_type: string;
  sha256: string;
  animated?: boolean;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'document' | 'audio' | 'voice' | 'location' | 'sticker' | 'reaction' | 'contacts' | 'interactive' | 'button' | 'order' | 'unknown';
  text?: WhatsAppTextMessage;
  image?: WhatsAppImageMessage;
  video?: WhatsAppVideoMessage;
  document?: WhatsAppDocumentMessage;
  audio?: WhatsAppAudioMessage;
  location?: WhatsAppLocationMessage;
  sticker?: WhatsAppStickerMessage;
}

interface WhatsAppStatusUpdate {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title: string }[];
}

interface WhatsAppValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatusUpdate[];
}

interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}

interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

// ---------------------------------------------------------------------------
// Message type detection & attachment extraction
// ---------------------------------------------------------------------------

type CrmMessageType = 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker' | 'location';

interface ParsedMessage {
  type: CrmMessageType;
  content: string | null;
  attachments: Record<string, unknown>[] | null;
  metadata: Record<string, unknown>;
}

function parseInboundMessage(msg: WhatsAppMessage): ParsedMessage {
  const metadata: Record<string, unknown> = {
    whatsapp_message_id: msg.id,
    whatsapp_from: msg.from,
    whatsapp_timestamp: msg.timestamp,
  };

  if (msg.image) {
    return {
      type: 'image',
      content: msg.image.caption ?? null,
      attachments: [{
        type: 'image',
        mediaId: msg.image.id,
        mimeType: msg.image.mime_type,
        sha256: msg.image.sha256,
      }],
      metadata,
    };
  }

  if (msg.video) {
    return {
      type: 'video',
      content: msg.video.caption ?? null,
      attachments: [{
        type: 'video',
        mediaId: msg.video.id,
        mimeType: msg.video.mime_type,
        sha256: msg.video.sha256,
      }],
      metadata,
    };
  }

  if (msg.audio) {
    return {
      type: msg.audio.voice ? 'voice' : 'document',
      content: null,
      attachments: [{
        type: msg.audio.voice ? 'voice' : 'audio',
        mediaId: msg.audio.id,
        mimeType: msg.audio.mime_type,
        sha256: msg.audio.sha256,
      }],
      metadata,
    };
  }

  if (msg.document) {
    return {
      type: 'document',
      content: msg.document.caption ?? null,
      attachments: [{
        type: 'document',
        mediaId: msg.document.id,
        mimeType: msg.document.mime_type,
        sha256: msg.document.sha256,
        fileName: msg.document.filename,
      }],
      metadata,
    };
  }

  if (msg.sticker) {
    return {
      type: 'sticker',
      content: null,
      attachments: [{
        type: 'sticker',
        mediaId: msg.sticker.id,
        mimeType: msg.sticker.mime_type,
        sha256: msg.sticker.sha256,
        animated: msg.sticker.animated,
      }],
      metadata,
    };
  }

  if (msg.location) {
    return {
      type: 'location',
      content: `${msg.location.latitude}, ${msg.location.longitude}`,
      attachments: [{
        type: 'location',
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
        name: msg.location.name,
        address: msg.location.address,
      }],
      metadata,
    };
  }

  // Plain text (default)
  return {
    type: 'text',
    content: msg.text?.body ?? null,
    attachments: null,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Contact resolution: find or create from WhatsApp user
// ---------------------------------------------------------------------------

async function findOrCreateContact(waId: string, profileName: string) {
  // 1. Primary lookup: direct whatsappPhoneId on the contact record
  const directMatch = await getContactByWhatsAppPhoneId(waId);
  if (directMatch) {
    // Sync name if changed
    if (directMatch.firstName !== profileName) {
      const updated = store.update('contacts', directMatch.id as string, { firstName: profileName });
      return updated ?? directMatch;
    }
    return directMatch;
  }

  // 2. Fallback: find via existing conversation
  const existingConversation = store.findOne('conversations', r =>
    r.channelType === 'whatsapp' && r.externalId === waId,
  );

  if (existingConversation) {
    const contact = store.getById('contacts', existingConversation.contactId as string);
    if (contact) {
      // Backfill whatsappPhoneId
      if (!contact.whatsappPhoneId) {
        store.update('contacts', contact.id as string, { whatsappPhoneId: waId });
      }
      return contact;
    }
  }

  // 3. Create a new contact
  const contact = await createContact({
    firstName: profileName,
    phone: `+${waId}`,
    source: 'whatsapp',
    whatsappPhoneId: waId,
    notes: `WhatsApp: +${waId}`,
  });

  eventBus.emit('contact_created', {
    contactId: contact.id,
    contact: contact as unknown as Record<string, unknown>,
  });

  return contact;
}

// ---------------------------------------------------------------------------
// Conversation resolution
// ---------------------------------------------------------------------------

async function findOrCreateConversation(
  waId: string,
  contactId: string,
  contact?: Record<string, unknown>,
) {
  const existing = store.findOne('conversations', r =>
    r.channelType === 'whatsapp' && r.externalId === waId,
  );

  if (existing) return { conversation: existing, isNew: false };

  const conversation = await createConversation({
    contactId,
    channelType: 'whatsapp',
    externalId: waId,
    status: 'open',
  });

  const tagNames = await getContactTagNames(contactId).catch(() => [] as string[]);
  eventBus.emit('conversation_created', {
    conversationId: conversation.id as string,
    contactId,
    conversation: conversation as unknown as Record<string, unknown>,
    contact: { ...(contact ?? {}), tagNames } as unknown as Record<string, unknown>,
  });

  return { conversation, isNew: true };
}

// ---------------------------------------------------------------------------
// Status update handler
// ---------------------------------------------------------------------------

async function handleStatusUpdate(status: WhatsAppStatusUpdate): Promise<void> {
  if (!status.id) return;

  const statusMap: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  };

  const crmStatus = statusMap[status.status];
  if (!crmStatus) return;

  // Update the message status by externalId
  const matchingMessages = store.find('messages', r => r.externalId === status.id);
  for (const msg of matchingMessages) {
    store.update('messages', msg.id as string, { status: crmStatus });
  }
}

// ---------------------------------------------------------------------------
// Main webhook handler
// ---------------------------------------------------------------------------

export interface WebhookResult {
  ok: boolean;
  messageId?: string;
  conversationId?: string;
  error?: string;
}

/**
 * Process an incoming WhatsApp Cloud API webhook notification.
 */
export async function handleWhatsAppWebhook(
  payload: WhatsAppWebhookPayload,
): Promise<WebhookResult> {
  if (payload.object !== 'whatsapp_business_account') {
    return { ok: true };
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      const phoneNumberId = value.metadata.phone_number_id;

      // Verify we have this account connected
      const account = await getAccountByPhoneNumberId(phoneNumberId);
      if (!account) continue;

      // Handle status updates (delivery receipts)
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status).catch(() => {});
        }
      }

      // Handle inbound messages
      if (value.messages && value.contacts) {
        for (let i = 0; i < value.messages.length; i++) {
          const waMsg = value.messages[i];
          const waContact = value.contacts[i] ?? value.contacts[0];

          // Skip unsupported types
          if (waMsg.type === 'reaction' || waMsg.type === 'unknown') continue;

          const result = await processInboundMessage(account as Record<string, unknown>, waMsg, waContact);
          if (!result.ok) {
            return result;
          }
        }
      }
    }
  }

  return { ok: true };
}

async function processInboundMessage(
  account: Record<string, unknown>,
  waMsg: WhatsAppMessage,
  waContact: WhatsAppContact,
): Promise<WebhookResult> {
  // 1. Find or create contact
  const contact = await findOrCreateContact(waMsg.from, waContact.profile.name);

  // 2. Find or create conversation
  const { conversation, isNew: isNewConversation } = await findOrCreateConversation(
    waMsg.from,
    contact.id as string,
    contact as unknown as Record<string, unknown>,
  );

  // 3. Parse the message
  const parsed = parseInboundMessage(waMsg);

  // 4. Store in messages table
  const messageData: SendMessageData = {
    conversationId: conversation.id as string,
    direction: 'inbound',
    type: parsed.type,
    content: parsed.content ?? undefined,
    externalId: waMsg.id,
    attachments: parsed.attachments ?? undefined,
    metadata: JSON.stringify(parsed.metadata),
  };

  const message = await sendMessage(messageData);

  if (!message) {
    return { ok: false, error: 'Failed to store message' };
  }

  // Emit automation trigger
  const contactTagNames = await getContactTagNames(contact.id as string).catch(() => [] as string[]);
  eventBus.emit('message_received', {
    messageId: message.id as string,
    conversationId: conversation.id as string,
    contactId: contact.id as string,
    message: message as unknown as Record<string, unknown>,
    contact: { ...contact, tagNames: contactTagNames } as unknown as Record<string, unknown>,
    conversation: conversation as unknown as Record<string, unknown>,
  });

  // 5. Reopen conversation if closed
  if (conversation.status === 'closed' || conversation.status === 'archived') {
    store.update('conversations', conversation.id as string, { status: 'open', closedAt: null });
  }

  // 6. Auto-greeting for new conversations
  if (isNewConversation && account.autoGreetingEnabled && account.autoGreetingText) {
    const greetingMessage = await sendMessage({
      conversationId: conversation.id as string,
      direction: 'outbound',
      type: 'text',
      content: account.autoGreetingText as string,
      metadata: JSON.stringify({ autoGreeting: true }),
    });

    if (greetingMessage) {
      sendWhatsAppMessage({
        conversationId: conversation.id as string,
        messageId: greetingMessage.id as string,
        text: account.autoGreetingText as string,
      }).catch(() => {
        // Fire-and-forget
      });
    }
  }

  return {
    ok: true,
    messageId: message.id as string,
    conversationId: conversation.id as string,
  };
}
