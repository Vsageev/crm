import { eventBus } from './event-bus.js';
import type {
  ContactCreatedEvent,
  DealCreatedEvent,
  DealStageChangedEvent,
  MessageReceivedEvent,
  CrmEventName,
} from './event-bus.js';
import { sendWebPush, type WebPushPayload } from './web-push.js';
import { store } from '../db/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAllManagerAndAdminIds(): Promise<string[]> {
  const rows = store.find('users', (r) => r.isActive === true);
  // For new leads / contacts we notify the owner if set, otherwise admins/managers
  return rows.map((r) => r.id as string);
}

function sendSafe(userId: string, payload: WebPushPayload) {
  sendWebPush(userId, payload).catch((err) => {
    console.error(`[web-push] Failed to send to user ${userId}:`, err);
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onContactCreated(payload: ContactCreatedEvent) {
  const contact = payload.contact as Record<string, unknown>;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  const source = contact.source ? ` (${contact.source})` : '';

  const pushPayload: WebPushPayload = {
    title: 'New Lead',
    body: `${name}${source}`,
    tag: `contact-${payload.contactId}`,
    data: { url: `/contacts/${payload.contactId}` },
  };

  // Notify the owner if assigned, otherwise skip (automation will assign)
  const ownerId = contact.ownerId as string | undefined;
  if (ownerId) {
    sendSafe(ownerId, pushPayload);
  }
}

function onDealCreated(payload: DealCreatedEvent) {
  const deal = payload.deal as Record<string, unknown>;

  const pushPayload: WebPushPayload = {
    title: 'New Deal',
    body: `${deal.title}${deal.value ? ` — ${deal.value} ${deal.currency ?? ''}` : ''}`,
    tag: `deal-${payload.dealId}`,
    data: { url: `/deals` },
  };

  const ownerId = deal.ownerId as string | undefined;
  if (ownerId) {
    sendSafe(ownerId, pushPayload);
  }
}

function onDealStageChanged(payload: DealStageChangedEvent) {
  const deal = payload.deal as Record<string, unknown>;

  const pushPayload: WebPushPayload = {
    title: 'Deal Stage Changed',
    body: `${deal.title} moved to ${payload.stageName}`,
    tag: `deal-stage-${payload.dealId}`,
    data: { url: `/deals` },
  };

  const ownerId = deal.ownerId as string | undefined;
  if (ownerId) {
    sendSafe(ownerId, pushPayload);
  }
}

function onMessageReceived(payload: MessageReceivedEvent) {
  const message = payload.message as Record<string, unknown>;
  const contact = payload.contact as Record<string, unknown> | undefined;
  const contactName = contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(' ')
    : 'Unknown';

  const body =
    typeof message.content === 'string' && message.content.length > 100
      ? message.content.slice(0, 100) + '...'
      : (message.content as string) ?? 'New message';

  const pushPayload: WebPushPayload = {
    title: `Message from ${contactName}`,
    body,
    tag: `msg-${payload.conversationId}`,
    data: { url: `/inbox` },
  };

  // Notify the conversation assignee or contact owner
  const assigneeId =
    (payload.conversation as Record<string, unknown> | undefined)?.assigneeId as string | undefined;
  const ownerId = contact?.ownerId as string | undefined;
  const targetUserId = assigneeId ?? ownerId;

  if (targetUserId) {
    sendSafe(targetUserId, pushPayload);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let initialized = false;

export function initWebPushEngine() {
  if (initialized) return;
  initialized = true;

  eventBus.on('contact_created', onContactCreated);
  eventBus.on('deal_created', onDealCreated);
  eventBus.on('deal_stage_changed', onDealStageChanged);
  eventBus.on('message_received', onMessageReceived);

  console.log('[web-push] Engine initialized — listening for critical events');
}
