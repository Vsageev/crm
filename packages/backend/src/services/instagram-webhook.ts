import crypto from 'node:crypto';
import { store } from '../db/index.js';
import { getPageByFacebookId } from './instagram.js';
import { createConversation } from './conversations.js';
import { sendMessage, type SendMessageData } from './messages.js';
import { createContact, getContactTagNames } from './contacts.js';
import { sendInstagramMessage } from './instagram-outbound.js';
import { eventBus } from './event-bus.js';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Instagram / Messenger webhook types
// ---------------------------------------------------------------------------

interface MessagingEntry {
  id: string; // Page ID
  time: number;
  messaging?: MessagingEvent[];
}

interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: InboundMessage;
  postback?: Postback;
  read?: { watermark: number };
}

interface InboundMessage {
  mid: string;
  text?: string;
  attachments?: Attachment[];
  is_echo?: boolean;
}

interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'location' | 'fallback';
  payload: {
    url?: string;
    coordinates?: { lat: number; long: number };
    title?: string;
    sticker_id?: number;
  };
}

interface Postback {
  mid?: string;
  title: string;
  payload: string;
}

export interface InstagramWebhookBody {
  object: 'page' | 'instagram';
  entry: MessagingEntry[];
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the X-Hub-Signature-256 header from Facebook.
 */
export function verifySignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!env.INSTAGRAM_APP_SECRET || !signatureHeader) return false;

  const expected = crypto
    .createHmac('sha256', env.INSTAGRAM_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  return signatureHeader === `sha256=${expected}`;
}

// ---------------------------------------------------------------------------
// Message type detection & attachment extraction
// ---------------------------------------------------------------------------

type CrmMessageType = 'text' | 'image' | 'video' | 'document' | 'voice' | 'location';

interface ParsedMessage {
  type: CrmMessageType;
  content: string | null;
  attachments: Record<string, unknown>[] | null;
  metadata: Record<string, unknown>;
}

function parseInboundMessage(event: MessagingEvent): ParsedMessage {
  const metadata: Record<string, unknown> = {
    instagram_sender_id: event.sender.id,
    instagram_recipient_id: event.recipient.id,
    instagram_timestamp: event.timestamp,
  };

  if (event.message) {
    metadata.instagram_mid = event.message.mid;
  }

  // Handle postback (button click)
  if (event.postback) {
    metadata.instagram_postback = {
      title: event.postback.title,
      payload: event.postback.payload,
    };
    return {
      type: 'text',
      content: `Clicked button: ${event.postback.title}`,
      attachments: null,
      metadata,
    };
  }

  const msg = event.message;
  if (!msg) {
    return { type: 'text', content: null, attachments: null, metadata };
  }

  // Handle attachments
  if (msg.attachments && msg.attachments.length > 0) {
    const att = msg.attachments[0];

    if (att.type === 'image') {
      return {
        type: 'image',
        content: msg.text ?? null,
        attachments: [
          {
            type: 'image',
            url: att.payload.url,
            stickerId: att.payload.sticker_id,
          },
        ],
        metadata,
      };
    }

    if (att.type === 'video') {
      return {
        type: 'video',
        content: msg.text ?? null,
        attachments: [{ type: 'video', url: att.payload.url }],
        metadata,
      };
    }

    if (att.type === 'audio') {
      return {
        type: 'voice',
        content: msg.text ?? null,
        attachments: [{ type: 'audio', url: att.payload.url }],
        metadata,
      };
    }

    if (att.type === 'file') {
      return {
        type: 'document',
        content: msg.text ?? null,
        attachments: [{ type: 'file', url: att.payload.url }],
        metadata,
      };
    }

    if (att.type === 'location' && att.payload.coordinates) {
      return {
        type: 'location',
        content: `${att.payload.coordinates.lat}, ${att.payload.coordinates.long}`,
        attachments: [
          {
            type: 'location',
            latitude: att.payload.coordinates.lat,
            longitude: att.payload.coordinates.long,
          },
        ],
        metadata,
      };
    }

    // Fallback attachment
    return {
      type: 'text',
      content: msg.text ?? att.payload.title ?? '[Unsupported attachment]',
      attachments: null,
      metadata,
    };
  }

  // Plain text
  return {
    type: 'text',
    content: msg.text ?? null,
    attachments: null,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Contact resolution: find or create from Instagram/Messenger user
// ---------------------------------------------------------------------------

async function getContactByInstagramId(instagramScopedId: string) {
  const contact = store.findOne('contacts', r => r.instagramScopedId === instagramScopedId);
  return contact ?? null;
}

async function getUserProfile(
  senderId: string,
  pageAccessToken: string,
): Promise<{ firstName: string; lastName?: string; profilePic?: string } | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${senderId}?fields=first_name,last_name,profile_pic&access_token=${pageAccessToken}`,
    );
    const data = (await res.json()) as {
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
      error?: { message: string };
    };

    if (data.error || !data.first_name) return null;

    return {
      firstName: data.first_name,
      lastName: data.last_name,
      profilePic: data.profile_pic,
    };
  } catch {
    return null;
  }
}

async function findOrCreateContact(
  senderId: string,
  pageAccessToken: string,
) {
  // 1. Primary lookup: direct instagramScopedId on the contact record
  const directMatch = await getContactByInstagramId(senderId);
  if (directMatch) return directMatch;

  // 2. Fallback: find via existing conversation
  const existingConversation = store.findOne('conversations', r =>
    r.channelType === 'instagram' && r.externalId === senderId,
  );

  if (existingConversation) {
    const contact = store.getById('contacts', existingConversation.contactId as string);
    if (contact) {
      // Backfill instagramScopedId
      if (!contact.instagramScopedId) {
        store.update('contacts', contact.id as string, { instagramScopedId: senderId });
      }
      return contact;
    }
  }

  // 3. Fetch user profile from Facebook/Instagram
  const profile = await getUserProfile(senderId, pageAccessToken);

  // 4. Create a new contact
  const contact = await createContact({
    firstName: profile?.firstName ?? 'Instagram User',
    lastName: profile?.lastName,
    source: 'other',
    instagramScopedId: senderId,
    notes: `Instagram/Messenger user (PSID: ${senderId})`,
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
  senderId: string,
  contactId: string,
  contact?: Record<string, unknown>,
) {
  const existing = store.findOne('conversations', r =>
    r.channelType === 'instagram' && r.externalId === senderId,
  );

  if (existing) return { conversation: existing, isNew: false };

  const conversation = await createConversation({
    contactId,
    channelType: 'instagram',
    externalId: senderId,
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
// Main webhook handler
// ---------------------------------------------------------------------------

export interface WebhookResult {
  ok: boolean;
  processed: number;
  error?: string;
}

/**
 * Process an incoming Instagram / Messenger webhook payload.
 */
export async function handleInstagramWebhook(
  body: InstagramWebhookBody,
  signatureHeader: string | undefined,
  rawBody: string | Buffer,
): Promise<WebhookResult> {
  // 1. Verify signature (if app secret is configured)
  if (env.INSTAGRAM_APP_SECRET && !verifySignature(rawBody, signatureHeader)) {
    return { ok: false, processed: 0, error: 'Invalid signature' };
  }

  let processed = 0;

  // 2. Process each entry (each corresponds to a Facebook Page)
  for (const entry of body.entry) {
    const pageId = entry.id;

    // Look up the page
    const page = await getPageByFacebookId(pageId);
    if (!page) continue;

    const messagingEvents = entry.messaging ?? [];

    for (const event of messagingEvents) {
      // Skip echo messages (sent by the page itself)
      if (event.message?.is_echo) continue;

      // Skip read receipts
      if (event.read) continue;

      // Must have a message or postback
      if (!event.message && !event.postback) continue;

      try {
        await processMessagingEvent(event, page as Record<string, unknown>);
        processed++;
      } catch (err) {
        // Log but continue processing other events
        console.error('Instagram webhook event processing error:', err);
      }
    }
  }

  return { ok: true, processed };
}

async function processMessagingEvent(
  event: MessagingEvent,
  page: Record<string, unknown>,
) {
  const senderId = event.sender.id;

  // Don't process messages from the page itself
  if (senderId === page.pageId) return;

  // 1. Find or create contact
  const contact = await findOrCreateContact(senderId, page.pageAccessToken as string);

  // 2. Find or create conversation
  const { conversation, isNew: isNewConversation } = await findOrCreateConversation(
    senderId,
    contact.id as string,
    contact as unknown as Record<string, unknown>,
  );

  // 3. Parse the message
  const parsed = parseInboundMessage(event);

  // 4. Store in messages table
  const messageData: SendMessageData = {
    conversationId: conversation.id as string,
    direction: 'inbound',
    type: parsed.type,
    content: parsed.content ?? undefined,
    externalId: event.message?.mid,
    attachments: parsed.attachments ?? undefined,
    metadata: JSON.stringify(parsed.metadata),
  };

  const message = await sendMessage(messageData);
  if (!message) return;

  // 5. Emit automation events
  const contactTagNames = await getContactTagNames(contact.id as string).catch(() => [] as string[]);
  eventBus.emit('message_received', {
    messageId: message.id as string,
    conversationId: conversation.id as string,
    contactId: contact.id as string,
    message: message as unknown as Record<string, unknown>,
    contact: { ...contact, tagNames: contactTagNames } as unknown as Record<string, unknown>,
    conversation: conversation as unknown as Record<string, unknown>,
  });

  // 6. Reopen conversation if it was closed
  if (conversation.status === 'closed' || conversation.status === 'archived') {
    store.update('conversations', conversation.id as string, { status: 'open', closedAt: null });
  }

  // 7. Auto-greeting for new conversations
  if (isNewConversation && page.autoGreetingEnabled && page.autoGreetingText) {
    const greetingMessage = await sendMessage({
      conversationId: conversation.id as string,
      direction: 'outbound',
      type: 'text',
      content: page.autoGreetingText as string,
      metadata: JSON.stringify({ autoGreeting: true }),
    });

    if (greetingMessage) {
      sendInstagramMessage({
        conversationId: conversation.id as string,
        messageId: greetingMessage.id as string,
        text: page.autoGreetingText as string,
      }).catch(() => {
        // Fire-and-forget
      });
    }
  }
}
