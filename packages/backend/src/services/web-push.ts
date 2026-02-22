// ---------------------------------------------------------------------------
// Web Push — STUBBED (web-push removed for prototyping)
// ---------------------------------------------------------------------------

import { store } from '../db/index.js';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// VAPID (no-op without the web-push package)
// ---------------------------------------------------------------------------

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

// ---------------------------------------------------------------------------
// Subscription management (these still work against the JSON store)
// ---------------------------------------------------------------------------

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export async function saveSubscription(
  userId: string,
  subscription: PushSubscriptionData,
  userAgent?: string,
) {
  const existing = store.findOne('pushSubscriptions', (r) => r.endpoint === subscription.endpoint);

  if (existing) {
    const updated = store.update('pushSubscriptions', existing.id as string, {
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: userAgent ?? null,
    });
    return updated;
  }

  const created = store.insert('pushSubscriptions', {
    userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    userAgent: userAgent ?? null,
  });

  return created;
}

export async function removeSubscription(userId: string, endpoint: string) {
  const deleted = store.deleteWhere('pushSubscriptions', (r) =>
    r.userId === userId && r.endpoint === endpoint,
  );
  return deleted.length > 0 ? deleted[0] : null;
}

export async function removeSubscriptionByEndpoint(endpoint: string) {
  store.deleteWhere('pushSubscriptions', (r) => r.endpoint === endpoint);
}

export async function getSubscriptionsByUserId(userId: string) {
  return store.find('pushSubscriptions', (r) => r.userId === userId);
}

// ---------------------------------------------------------------------------
// Sending push notifications — STUB
// ---------------------------------------------------------------------------

export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

/**
 * Send a web push notification to all subscriptions for a given user.
 * STUB: logs the attempt and returns 0.
 */
export async function sendWebPush(userId: string, payload: WebPushPayload): Promise<number> {
  console.log(
    `[web-push] Push sending not available (dependencies removed for prototyping). userId=${userId}, title="${payload.title}"`,
  );
  return 0;
}

/**
 * Send a web push notification to multiple users at once.
 * STUB: returns zero sent for each user.
 */
export async function sendWebPushBatch(
  items: Array<{ userId: string; payload: WebPushPayload }>,
): Promise<{ userId: string; sent: number }[]> {
  return items.map((item) => ({ userId: item.userId, sent: 0 }));
}
