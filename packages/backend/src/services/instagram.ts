import crypto from 'node:crypto';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { createAuditLog } from './audit-log.js';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

interface FacebookPageInfo {
  id: string;
  name: string;
  access_token?: string;
}

interface InstagramAccountInfo {
  id: string;
  username?: string;
}

interface GraphApiResponse<T> {
  data?: T;
  error?: { message: string; type: string; code: number };
}

async function graphRequest<T>(url: string, accessToken: string): Promise<T> {
  const separator = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${separator}access_token=${accessToken}`);
  const data = (await res.json()) as T & { error?: { message: string } };

  if (data.error) {
    throw new Error(data.error.message ?? 'Facebook Graph API error');
  }

  return data;
}

/**
 * Validate a Page Access Token by calling the Graph API /me endpoint.
 */
export async function validatePageToken(
  pageAccessToken: string,
): Promise<{ pageId: string; pageName: string }> {
  const data = await graphRequest<FacebookPageInfo>(
    `${GRAPH_API}/me?fields=id,name`,
    pageAccessToken,
  );

  return { pageId: data.id, pageName: data.name };
}

/**
 * Look up the Instagram Business Account linked to a Facebook Page.
 */
export async function getLinkedInstagramAccount(
  pageId: string,
  pageAccessToken: string,
): Promise<{ instagramAccountId: string; instagramUsername?: string } | null> {
  try {
    const data = await graphRequest<{
      instagram_business_account?: { id: string };
    }>(`${GRAPH_API}/${pageId}?fields=instagram_business_account`, pageAccessToken);

    if (!data.instagram_business_account) return null;

    const igId = data.instagram_business_account.id;

    // Get username
    const igData = await graphRequest<InstagramAccountInfo>(
      `${GRAPH_API}/${igId}?fields=id,username`,
      pageAccessToken,
    );

    return {
      instagramAccountId: igId,
      instagramUsername: igData.username,
    };
  } catch {
    return null;
  }
}

/**
 * Subscribe the app to page webhooks (messages, messaging_postbacks, etc.).
 */
async function subscribePageToWebhook(pageId: string, pageAccessToken: string): Promise<void> {
  const url = `${GRAPH_API}/${pageId}/subscribed_apps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: pageAccessToken,
      subscribed_fields: ['messages', 'messaging_postbacks', 'message_reads'],
    }),
  });

  const data = (await res.json()) as { success?: boolean; error?: { message: string } };

  if (data.error) {
    throw new Error(data.error.message ?? 'Failed to subscribe page to webhook');
  }
}

/**
 * Connect a Facebook Page for Instagram / Messenger integration.
 */
export async function connectPage(
  pageAccessToken: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // 1. Validate token and get page info
  const { pageId, pageName } = await validatePageToken(pageAccessToken);

  // 2. Check if this page is already connected
  const existing = store.findOne('instagramPages', r => r.pageId === pageId);

  if (existing) {
    throw new Error(`Page "${pageName}" is already connected`);
  }

  // 3. Look up linked Instagram account
  const igAccount = await getLinkedInstagramAccount(pageId, pageAccessToken);

  // 4. Generate webhook verify token
  const webhookVerifyToken = crypto.randomBytes(32).toString('hex');

  // 5. Subscribe page to webhook events
  let status: 'active' | 'inactive' | 'error' = 'inactive';
  let statusMessage: string | null = null;

  try {
    await subscribePageToWebhook(pageId, pageAccessToken);
    status = 'active';
  } catch (err) {
    status = 'error';
    statusMessage = err instanceof Error ? err.message : 'Failed to subscribe to webhook';
  }

  // 6. Store in DB
  const page = store.insert('instagramPages', {
    pageId,
    pageName,
    pageAccessToken,
    instagramAccountId: igAccount?.instagramAccountId,
    instagramUsername: igAccount?.instagramUsername,
    webhookVerifyToken,
    status,
    statusMessage,
    createdById: audit?.userId,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'instagram_page',
      entityId: page.id as string,
      changes: { pageId, pageName, status },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizePage(page);
}

/**
 * Disconnect a Facebook Page.
 */
export async function disconnectPage(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('instagramPages', id);
  if (!deleted) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'instagram_page',
      entityId: id,
      changes: { pageName: deleted.pageName },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizePage(deleted);
}

/**
 * List all connected pages.
 */
export async function listPages() {
  const pages = store.getAll('instagramPages');
  return pages.map(sanitizePage);
}

/**
 * Get a single page by ID.
 */
export async function getPageById(id: string) {
  const page = store.getById('instagramPages', id);
  if (!page) return null;
  return sanitizePage(page);
}

/**
 * Get a raw page record (with token) for internal use.
 */
export async function getPageRaw(id: string) {
  const page = store.getById('instagramPages', id);
  return page ?? null;
}

/**
 * Get a page by its Facebook Page ID (for webhook routing).
 */
export async function getPageByFacebookId(pageId: string) {
  const page = store.findOne('instagramPages', r => r.pageId === pageId);
  return page ?? null;
}

/**
 * Get the first active page (for outbound messages).
 */
export async function getActiveInstagramPage() {
  const page = store.findOne('instagramPages', r => r.status === 'active');
  return page ?? null;
}

/**
 * Re-subscribe page to webhook events.
 */
export async function refreshWebhook(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const page = store.getById('instagramPages', id);
  if (!page) return null;

  let status: 'active' | 'inactive' | 'error' = 'inactive';
  let statusMessage: string | null = null;

  try {
    await subscribePageToWebhook(page.pageId as string, page.pageAccessToken as string);
    status = 'active';
  } catch (err) {
    status = 'error';
    statusMessage = err instanceof Error ? err.message : 'Failed to subscribe to webhook';
  }

  const webhookVerifyToken = crypto.randomBytes(32).toString('hex');

  const updated = store.update('instagramPages', id, { webhookVerifyToken, status, statusMessage });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'instagram_page',
      entityId: id,
      changes: { status },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated ? sanitizePage(updated) : null;
}

/**
 * Update auto-greeting settings for a page.
 */
export async function updateAutoGreeting(
  id: string,
  data: { enabled: boolean; text?: string | null },
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const page = store.getById('instagramPages', id);
  if (!page) return null;

  const updated = store.update('instagramPages', id, {
    autoGreetingEnabled: data.enabled,
    autoGreetingText: data.text ?? null,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'instagram_page',
      entityId: id,
      changes: { autoGreetingEnabled: data.enabled, autoGreetingText: data.text },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated ? sanitizePage(updated) : null;
}

/**
 * Strip the access token from page objects before returning to clients.
 */
function sanitizePage(page: Record<string, unknown>) {
  const { pageAccessToken, webhookVerifyToken, ...safe } = page;
  return { ...safe, tokenSet: (pageAccessToken as string).length > 0 };
}
