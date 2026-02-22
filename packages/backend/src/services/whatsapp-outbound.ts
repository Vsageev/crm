import { store } from '../db/index.js';
import { updateMessageStatus } from './messages.js';

const WHATSAPP_GRAPH_API = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WhatsAppApiResponse {
  messaging_product: string;
  contacts?: { input: string; wa_id: string }[];
  messages?: { id: string }[];
  error?: { message: string; type: string; code: number };
}

export interface SendWhatsAppMessageParams {
  conversationId: string;
  messageId: string;
  text: string;
}

export interface SendWhatsAppMessageResult {
  ok: boolean;
  whatsappMessageId?: string;
  error?: string;
}

export interface SendWhatsAppMediaParams {
  conversationId: string;
  messageId: string;
  type: 'image' | 'video' | 'document' | 'audio';
  mediaUrl: string;
  caption?: string;
  fileName?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function whatsappPost(
  accessToken: string,
  phoneNumberId: string,
  body: Record<string, unknown>,
): Promise<WhatsAppApiResponse> {
  const url = `${WHATSAPP_GRAPH_API}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as WhatsAppApiResponse;
}

/**
 * Resolve the WhatsApp account and recipient phone for a conversation.
 */
async function resolveConversationAccount(conversationId: string) {
  const conversation = store.getById('conversations', conversationId);

  if (!conversation || conversation.channelType !== 'whatsapp' || !conversation.externalId) {
    return null;
  }

  // Find an active WhatsApp account to send with
  const account = store.findOne('whatsappAccounts', r => r.status === 'active');

  if (!account) return null;

  return {
    accessToken: account.accessToken as string,
    phoneNumberId: account.phoneNumberId as string,
    recipientPhone: conversation.externalId as string,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a text message via WhatsApp Cloud API.
 */
export async function sendWhatsAppMessage(
  params: SendWhatsAppMessageParams,
): Promise<SendWhatsAppMessageResult> {
  const resolved = await resolveConversationAccount(params.conversationId);

  if (!resolved) {
    await updateMessageStatus(params.messageId, 'failed');
    return { ok: false, error: 'Not a WhatsApp conversation or no active account' };
  }

  const { accessToken, phoneNumberId, recipientPhone } = resolved;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
    type: 'text',
    text: { body: params.text },
  };

  try {
    const result = await whatsappPost(accessToken, phoneNumberId, body);

    if (result.error) {
      await updateMessageStatus(params.messageId, 'failed');
      return { ok: false, error: result.error.message };
    }

    const waMessageId = result.messages?.[0]?.id;

    // Update CRM message with WhatsApp message ID and mark as sent
    store.update('messages', params.messageId, {
      externalId: waMessageId ?? null,
      status: 'sent',
    });

    return { ok: true, whatsappMessageId: waMessageId };
  } catch (err) {
    await updateMessageStatus(params.messageId, 'failed');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to send WhatsApp message',
    };
  }
}

/**
 * Send a media message (image, video, document, audio) via WhatsApp Cloud API.
 */
export async function sendWhatsAppMedia(
  params: SendWhatsAppMediaParams,
): Promise<SendWhatsAppMessageResult> {
  const resolved = await resolveConversationAccount(params.conversationId);

  if (!resolved) {
    await updateMessageStatus(params.messageId, 'failed');
    return { ok: false, error: 'Not a WhatsApp conversation or no active account' };
  }

  const { accessToken, phoneNumberId, recipientPhone } = resolved;

  const mediaObject: Record<string, unknown> = { link: params.mediaUrl };
  if (params.caption) {
    mediaObject.caption = params.caption;
  }
  if (params.type === 'document' && params.fileName) {
    mediaObject.filename = params.fileName;
  }

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipientPhone,
    type: params.type,
    [params.type]: mediaObject,
  };

  try {
    const result = await whatsappPost(accessToken, phoneNumberId, body);

    if (result.error) {
      await updateMessageStatus(params.messageId, 'failed');
      return { ok: false, error: result.error.message };
    }

    const waMessageId = result.messages?.[0]?.id;

    store.update('messages', params.messageId, {
      externalId: waMessageId ?? null,
      status: 'sent',
    });

    return { ok: true, whatsappMessageId: waMessageId };
  } catch (err) {
    await updateMessageStatus(params.messageId, 'failed');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to send WhatsApp media',
    };
  }
}

/**
 * Mark a message as read via WhatsApp Cloud API.
 */
export async function markWhatsAppMessageRead(
  conversationId: string,
  whatsappMessageId: string,
): Promise<boolean> {
  const resolved = await resolveConversationAccount(conversationId);
  if (!resolved) return false;

  const { accessToken, phoneNumberId } = resolved;

  const body = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: whatsappMessageId,
  };

  try {
    const result = await whatsappPost(accessToken, phoneNumberId, body);
    return !result.error;
  } catch {
    return false;
  }
}
