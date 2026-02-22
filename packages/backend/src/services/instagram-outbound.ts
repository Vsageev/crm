import { store } from '../db/index.js';
import { updateMessageStatus } from './messages.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphApiSendResponse {
  recipient_id?: string;
  message_id?: string;
  error?: { message: string; type: string; code: number };
}

export interface SendInstagramMessageParams {
  conversationId: string;
  messageId: string;
  text: string;
}

export interface SendInstagramMessageResult {
  ok: boolean;
  fbMessageId?: string;
  error?: string;
}

export interface SendInstagramMediaParams {
  conversationId: string;
  messageId: string;
  type: 'image' | 'video' | 'audio' | 'file';
  url: string;
  caption?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the page access token and recipient PSID for a conversation.
 */
async function resolveConversationPage(conversationId: string) {
  const conversation = store.getById('conversations', conversationId);

  if (!conversation || conversation.channelType !== 'instagram' || !conversation.externalId) {
    return null;
  }

  // Find an active Instagram page to send with
  const page = store.findOne('instagramPages', r => r.status === 'active');

  if (!page) return null;

  return { pageAccessToken: page.pageAccessToken as string, recipientId: conversation.externalId as string };
}

/**
 * Send a message via the Facebook Send API.
 */
async function sendViaApi(
  pageAccessToken: string,
  recipientId: string,
  messagePayload: Record<string, unknown>,
): Promise<GraphApiSendResponse> {
  const url = `${GRAPH_API}/me/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: pageAccessToken,
      recipient: { id: recipientId },
      message: messagePayload,
      messaging_type: 'RESPONSE',
    }),
  });

  return (await res.json()) as GraphApiSendResponse;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a text message via Instagram / Messenger.
 */
export async function sendInstagramMessage(
  params: SendInstagramMessageParams,
): Promise<SendInstagramMessageResult> {
  const resolved = await resolveConversationPage(params.conversationId);

  if (!resolved) {
    await updateMessageStatus(params.messageId, 'failed');
    return { ok: false, error: 'Not an Instagram conversation or no active page' };
  }

  const { pageAccessToken, recipientId } = resolved;

  try {
    const result = await sendViaApi(pageAccessToken, recipientId, {
      text: params.text,
    });

    if (result.error) {
      await updateMessageStatus(params.messageId, 'failed');
      return { ok: false, error: result.error.message };
    }

    // Update CRM message with Facebook's message_id and mark as sent
    store.update('messages', params.messageId, {
      externalId: result.message_id,
      status: 'sent',
    });

    return { ok: true, fbMessageId: result.message_id };
  } catch (err) {
    await updateMessageStatus(params.messageId, 'failed');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to send Instagram message',
    };
  }
}

/**
 * Send a media attachment (image, video, audio, file) via Instagram / Messenger.
 */
export async function sendInstagramMedia(
  params: SendInstagramMediaParams,
): Promise<SendInstagramMessageResult> {
  const resolved = await resolveConversationPage(params.conversationId);

  if (!resolved) {
    await updateMessageStatus(params.messageId, 'failed');
    return { ok: false, error: 'Not an Instagram conversation or no active page' };
  }

  const { pageAccessToken, recipientId } = resolved;

  // Map CRM types to Facebook attachment types
  const fbTypeMap: Record<string, string> = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    file: 'file',
  };

  const fbType = fbTypeMap[params.type] ?? 'file';

  try {
    const messagePayload: Record<string, unknown> = {
      attachment: {
        type: fbType,
        payload: { url: params.url, is_reusable: true },
      },
    };

    const result = await sendViaApi(pageAccessToken, recipientId, messagePayload);

    if (result.error) {
      await updateMessageStatus(params.messageId, 'failed');
      return { ok: false, error: result.error.message };
    }

    store.update('messages', params.messageId, {
      externalId: result.message_id,
      status: 'sent',
    });

    return { ok: true, fbMessageId: result.message_id };
  } catch (err) {
    await updateMessageStatus(params.messageId, 'failed');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to send Instagram media',
    };
  }
}
