import { store } from '../db/index.js';
import { getRawAccountById, requestRecording } from './novofon.js';

interface NovofonWebhookBody {
  event: string;
  call_start?: string;
  pbx_call_id?: string;
  caller_id?: string;
  called_did?: string;
  duration?: string;
  disposition?: string;
  status_code?: string;
  call_id_with_rec?: string;
}

/**
 * Main webhook handler for Novofon call events.
 */
export async function handleNovofonWebhook(body: NovofonWebhookBody): Promise<{ ok: boolean }> {
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
async function handleCallStart(body: NovofonWebhookBody) {
  const phone = body.caller_id || body.called_did;
  if (!phone) return;

  const contact = await findOrCreateContactByPhone(phone);

  // Create conversation for this call
  const conversation = store.insert('conversations', {
    contactId: contact.id,
    assigneeId: null,
    channelType: 'novofon',
    status: 'open',
    subject: `Call ${body.pbx_call_id || ''}`.trim(),
    externalId: body.pbx_call_id || null,
    isUnread: true,
    lastMessageAt: new Date().toISOString(),
    closedAt: null,
    metadata: JSON.stringify({ pbx_call_id: body.pbx_call_id, call_start: body.call_start }),
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
    content: `Call started from ${body.caller_id || 'unknown'} to ${body.called_did || 'unknown'}`,
    status: 'delivered',
    externalId: body.pbx_call_id || null,
    attachments: null,
    metadata: null,
  });
}

/**
 * Handle NOTIFY_END — call ended.
 */
async function handleCallEnd(body: NovofonWebhookBody) {
  const pbxCallId = body.pbx_call_id;
  if (!pbxCallId) return;

  // Find conversation by externalId
  const conversation = store.findOne('conversations', (r) => r.externalId === pbxCallId && r.channelType === 'novofon');

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
      externalId: pbxCallId,
      attachments: null,
      metadata: null,
    });
  }

  // Determine direction: if caller_id matches a contact phone, it's inbound
  const phone = body.caller_id || body.called_did;
  const direction = body.caller_id ? 'inbound' : 'outbound';
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
      pbx_call_id: pbxCallId,
      caller_id: body.caller_id || '',
      called_did: body.called_did || '',
      disposition: body.disposition || '',
      status_code: body.status_code || '',
      direction,
    },
  });
}

/**
 * Handle NOTIFY_RECORD — recording ready.
 */
async function handleRecordReady(body: NovofonWebhookBody) {
  const pbxCallId = body.pbx_call_id;
  const callIdWithRec = body.call_id_with_rec;
  if (!pbxCallId || !callIdWithRec) return;

  // Find a Novofon account to use for the API call
  const accounts = store.getAll('novofonAccounts');
  const account = accounts.find((a) => a.status === 'active');
  if (!account) return;

  const rawAccount = getRawAccountById(account.id as string);
  if (!rawAccount) return;

  // Fetch recording URL
  const recordingUrl = await requestRecording(
    rawAccount.apiKey as string,
    rawAccount.apiSecret as string,
    callIdWithRec,
    pbxCallId,
  );

  if (!recordingUrl) return;

  // Update activity log meta with recording URL
  const activityLog = store.findOne('activityLogs', (r) => {
    const meta = r.meta as Record<string, string> | null;
    return meta?.pbx_call_id === pbxCallId;
  });

  if (activityLog) {
    const existingMeta = (activityLog.meta as Record<string, string>) || {};
    store.update('activityLogs', activityLog.id as string, {
      meta: { ...existingMeta, recording_url: recordingUrl },
    });
  }

  // Add recording as a voice message in the conversation
  const conversation = store.findOne('conversations', (r) => r.externalId === pbxCallId && r.channelType === 'novofon');
  if (conversation) {
    store.insert('messages', {
      conversationId: conversation.id,
      senderId: null,
      direction: 'inbound',
      type: 'voice',
      content: 'Call recording',
      status: 'delivered',
      externalId: `rec_${pbxCallId}`,
      attachments: [{ type: 'voice', url: recordingUrl, fileName: `recording_${pbxCallId}.mp3` }],
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
    source: 'novofon',
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
