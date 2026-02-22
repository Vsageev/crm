import crypto from 'node:crypto';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { createAuditLog } from './audit-log.js';

const WHATSAPP_GRAPH_API = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WhatsAppPhoneNumberInfo {
  verified_name: string;
  display_phone_number: string;
  id: string;
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API helpers
// ---------------------------------------------------------------------------

async function whatsappRequest<T>(
  accessToken: string,
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${WHATSAPP_GRAPH_API}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(url, options);
  const data = (await res.json()) as { error?: { message: string } } & T;

  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `WhatsApp API error: ${res.status}`);
  }

  return data;
}

/**
 * Validate a WhatsApp Business API access token by fetching phone number info.
 */
export async function validateWhatsAppCredentials(
  accessToken: string,
  phoneNumberId: string,
): Promise<WhatsAppPhoneNumberInfo> {
  return whatsappRequest<WhatsAppPhoneNumberInfo>(
    accessToken,
    `/${phoneNumberId}?fields=verified_name,display_phone_number`,
  );
}

/**
 * Subscribe the app to the WhatsApp Business Account webhooks.
 */
export async function subscribeToWebhooks(
  accessToken: string,
  businessAccountId: string,
): Promise<void> {
  await whatsappRequest(
    accessToken,
    `/${businessAccountId}/subscribed_apps`,
    'POST',
  );
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Connect a new WhatsApp Business account.
 */
export async function connectWhatsAppAccount(
  data: {
    phoneNumberId: string;
    businessAccountId: string;
    accessToken: string;
    accountName: string;
  },
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // 1. Validate credentials with WhatsApp API
  const phoneInfo = await validateWhatsAppCredentials(data.accessToken, data.phoneNumberId);

  // 2. Check if this phone number is already connected
  const existing = store.findOne('whatsappAccounts', r => r.phoneNumberId === data.phoneNumberId);

  if (existing) {
    throw new Error(`Phone number ${phoneInfo.display_phone_number} is already connected`);
  }

  // 3. Generate webhook verify token
  const webhookVerifyToken = crypto.randomBytes(32).toString('hex');

  // 4. Subscribe to webhooks
  let status: 'active' | 'inactive' | 'error' = 'inactive';
  let statusMessage: string | null = null;

  try {
    await subscribeToWebhooks(data.accessToken, data.businessAccountId);
    status = 'active';
  } catch (err) {
    status = 'error';
    statusMessage = err instanceof Error ? err.message : 'Failed to subscribe to webhooks';
  }

  // 5. Store in DB
  const account = store.insert('whatsappAccounts', {
    phoneNumberId: data.phoneNumberId,
    businessAccountId: data.businessAccountId,
    displayPhoneNumber: phoneInfo.display_phone_number,
    accessToken: data.accessToken,
    webhookVerifyToken,
    accountName: data.accountName || phoneInfo.verified_name,
    status,
    statusMessage,
    createdById: audit?.userId,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'whatsapp_account',
      entityId: account.id as string,
      changes: { phoneNumberId: data.phoneNumberId, status },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(account);
}

/**
 * Disconnect a WhatsApp account.
 */
export async function disconnectWhatsAppAccount(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('whatsappAccounts', id);
  if (!deleted) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'whatsapp_account',
      entityId: id,
      changes: { phoneNumberId: deleted.phoneNumberId, accountName: deleted.accountName },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(deleted);
}

/**
 * List all connected WhatsApp accounts.
 */
export async function listWhatsAppAccounts() {
  const accounts = store.getAll('whatsappAccounts');
  return accounts.map(sanitizeAccount);
}

/**
 * Get a single WhatsApp account by ID.
 */
export async function getWhatsAppAccountById(id: string) {
  const account = store.getById('whatsappAccounts', id);
  if (!account) return null;
  return sanitizeAccount(account);
}

/**
 * Get a raw account (with access token) by phone number ID — for webhook routing.
 */
export async function getAccountByPhoneNumberId(phoneNumberId: string) {
  const account = store.findOne('whatsappAccounts', r => r.phoneNumberId === phoneNumberId);
  return account ?? null;
}

/**
 * Get any active WhatsApp account (for outbound sending).
 */
export async function getActiveWhatsAppAccount() {
  const account = store.findOne('whatsappAccounts', r => r.status === 'active');
  return account ?? null;
}

/**
 * Re-test WhatsApp API connection.
 */
export async function testWhatsAppAccount(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const account = store.getById('whatsappAccounts', id);
  if (!account) return null;

  let status: 'active' | 'error' = 'active';
  let statusMessage: string | null = null;

  try {
    await validateWhatsAppCredentials(account.accessToken as string, account.phoneNumberId as string);
  } catch (err) {
    status = 'error';
    statusMessage = err instanceof Error ? err.message : 'WhatsApp API validation failed';
  }

  const updated = store.update('whatsappAccounts', id, { status, statusMessage });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'whatsapp_account',
      entityId: id,
      changes: { status, statusMessage },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated ? sanitizeAccount(updated) : null;
}

/**
 * Update auto-greeting settings for a WhatsApp account.
 */
export async function updateAutoGreeting(
  id: string,
  data: { enabled: boolean; text?: string | null },
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const account = store.getById('whatsappAccounts', id);
  if (!account) return null;

  const updated = store.update('whatsappAccounts', id, {
    autoGreetingEnabled: data.enabled,
    autoGreetingText: data.text ?? null,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'whatsapp_account',
      entityId: id,
      changes: { autoGreetingEnabled: data.enabled, autoGreetingText: data.text },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated ? sanitizeAccount(updated) : null;
}

// ---------------------------------------------------------------------------
// Sanitize — strip sensitive fields before returning to clients
// ---------------------------------------------------------------------------

function sanitizeAccount(account: Record<string, unknown>) {
  const { accessToken, webhookVerifyToken, ...safe } = account;
  return {
    ...safe,
    accessTokenMasked: `${(accessToken as string).slice(0, 8)}...${(accessToken as string).slice(-4)}`,
  };
}
