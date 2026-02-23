import { store } from '../db/index.js';
import { getRawAccountById, getCallRecordingUrl } from './voximplant.js';

interface VoximplantWebhookBody {
  event: string;
  call_start?: string;
  call_session_history_id?: string;
  phone_a?: string;
  phone_b?: string;
  duration?: string;
  disposition?: string;
  status_code?: string;
  record_url?: string;
}

/**
 * Main webhook handler for Voximplant call events.
 */
export async function handleVoximplantWebhook(body: VoximplantWebhookBody): Promise<{ ok: boolean }> {
  const { event } = body;

  switch (event) {
    case 'NOTIFY_START':
      await handleCallStart(body);
      break;
    case 'NOTIFY_END':
      await handleCallEnd(body);
      break;
    case 'NOTIFY_RECORD':
      await handleRecordReady(body);
      break;
    default:
      // Unknown event — ignore
      break;
  }

  return { ok: true };
}

/**
 * Handle NOTIFY_START — call started.
 */
async function handleCallStart(body: VoximplantWebhookBody) {
  const phone = body.phone_a || body.phone_b;
  if (!phone) return;

  const contact = await findOrCreateContactByPhone(phone);

  // Create conversation for this call
  const conversation = store.insert('conversations', {
    contactId: contact.id,
    assigneeId: null,
    channelType: 'voximplant',
    status: 'open',
    subject: `Call ${body.call_session_history_id || ''}`.trim(),
    externalId: body.call_session_history_id || null,
    isUnread: true,
    lastMessageAt: new Date().toISOString(),
    closedAt: null,
    metadata: JSON.stringify({ call_session_history_id: body.call_session_history_id, call_start: body.call_start }),
    activeChatbotFlowId: null,
    chatbotFlowStepId: null,
    chatbotFlowData: {},
  });

  // System message: call started
  store.insert('messages', {
    conversationId: conversation.id,
    senderId: null,
    direction: 'inbound',
    type: 'system',
    content: `Call started from ${body.phone_a || 'unknown'} to ${body.phone_b || 'unknown'}`,
    status: 'delivered',
    externalId: body.call_session_history_id || null,
    attachments: null,
    metadata: null,
  });
}

/**
 * Handle NOTIFY_END — call ended.
 */
async function handleCallEnd(body: VoximplantWebhookBody) {
  const callId = body.call_session_history_id;
  if (!callId) return;

  // Find conversation by externalId
  const conversation = store.findOne('conversations', (r) => r.externalId === callId && r.channelType === 'voximplant');

  if (conversation) {
    // Update conversation
    store.update('conversations', conversation.id as string, {
      status: 'closed',
      closedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    });

    // Add system message with call summary
    const duration = body.duration ? parseInt(body.duration, 10) : 0;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    const disposition = body.disposition || 'unknown';

    store.insert('messages', {
      conversationId: conversation.id,
      senderId: null,
      direction: 'inbound',
      type: 'system',
      content: `Call ended — Duration: ${durationStr}, Status: ${disposition}`,
      status: 'delivered',
      externalId: callId,
      attachments: null,
      metadata: null,
    });
  }

  // Determine direction
  const phone = body.phone_a || body.phone_b;
  const direction = body.phone_a ? 'inbound' : 'outbound';
  const duration = body.duration ? parseInt(body.duration, 10) : 0;

  // Create activity log for the call
  store.insert('activityLogs', {
    type: 'call',
    title: `Phone call (${direction}) — ${phone || 'unknown'}`,
    description: `Duration: ${duration}s, Disposition: ${body.disposition || 'unknown'}`,
    contactId: conversation ? (conversation.contactId as string) : null,
    dealId: null,
    duration,
    occurredAt: body.call_start || new Date().toISOString(),
    createdById: null,
    meta: {
      call_session_history_id: callId,
      phone_a: body.phone_a || '',
      phone_b: body.phone_b || '',
      disposition: body.disposition || '',
      status_code: body.status_code || '',
      direction,
    },
  });
}

/**
 * Handle NOTIFY_RECORD — recording ready.
 */
async function handleRecordReady(body: VoximplantWebhookBody) {
  const callId = body.call_session_history_id;
  if (!callId) return;

  let recordingUrl = body.record_url || null;

  // If no URL in webhook body, try fetching via API
  if (!recordingUrl) {
    const accounts = store.getAll('voximplantAccounts');
    const account = accounts.find((a) => a.status === 'active');
    if (!account) return;

    const rawAccount = getRawAccountById(account.id as string);
    if (!rawAccount) return;

    recordingUrl = await getCallRecordingUrl(
      rawAccount.accountId as string,
      rawAccount.keyId as string,
      rawAccount.privateKey as string,
      callId,
    );
  }

  if (!recordingUrl) return;

  // Update activity log meta with recording URL
  const activityLog = store.findOne('activityLogs', (r) => {
    const meta = r.meta as Record<string, string> | null;
    return meta?.call_session_history_id === callId;
  });

  if (activityLog) {
    const existingMeta = (activityLog.meta as Record<string, string>) || {};
    store.update('activityLogs', activityLog.id as string, {
      meta: { ...existingMeta, recording_url: recordingUrl },
    });
  }

  // Add recording as a voice message in the conversation
  const conversation = store.findOne('conversations', (r) => r.externalId === callId && r.channelType === 'voximplant');
  if (conversation) {
    store.insert('messages', {
      conversationId: conversation.id,
      senderId: null,
      direction: 'inbound',
      type: 'voice',
      content: 'Call recording',
      status: 'delivered',
      externalId: `rec_${callId}`,
      attachments: [{ type: 'voice', url: recordingUrl, fileName: `recording_${callId}.mp3` }],
      metadata: JSON.stringify({ recording_url: recordingUrl }),
    });
  }
}

/**
 * Find or create a contact by phone number.
 */
async function findOrCreateContactByPhone(phone: string): Promise<Record<string, unknown>> {
  // Normalize phone: strip non-digit chars for comparison
  const normalized = phone.replace(/\D/g, '');

  const existing = store.findOne('contacts', (r) => {
    const contactPhone = (r.phone as string) || '';
    return contactPhone.replace(/\D/g, '') === normalized;
  });

  if (existing) return existing;

  // Auto-create contact
  return store.insert('contacts', {
    firstName: phone,
    lastName: null,
    email: null,
    phone,
    position: null,
    companyId: null,
    ownerId: null,
    source: 'voximplant',
    telegramId: null,
    whatsappPhoneId: null,
    instagramScopedId: null,
    notes: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    referrerUrl: null,
  });
}
