import crypto from 'node:crypto';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { createAuditLog } from './audit-log.js';

const NOVOFON_API = 'https://api.novofon.com';

interface NovofonApiResponse {
  status: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Build HMAC-SHA1 Authorization header for Novofon API.
 */
function buildAuthHeader(apiKey: string, apiSecret: string, method: string, params: Record<string, string> = {}): string {
  // Sort params alphabetically by key, urlencode values
  const sortedKeys = Object.keys(params).sort();
  const pairs = sortedKeys.map((k) => `${k}=${encodeURIComponent(params[k])}`);
  const paramsString = pairs.join('&');

  // sign_string = method + paramsString + md5(paramsString)
  const md5Hash = crypto.createHash('md5').update(paramsString).digest('hex');
  const signString = method + paramsString + md5Hash;

  // HMAC-SHA1
  const signature = crypto.createHmac('sha1', apiSecret).update(signString).digest('hex');

  return `${apiKey}:${signature}`;
}

/**
 * Make an authenticated request to Novofon API.
 */
async function novofonRequest(
  apiKey: string,
  apiSecret: string,
  method: string,
  httpMethod: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET',
  params: Record<string, string> = {},
): Promise<NovofonApiResponse> {
  const authHeader = buildAuthHeader(apiKey, apiSecret, method, params);

  let url = `${NOVOFON_API}${method}`;
  let body: string | undefined;

  if (httpMethod === 'GET') {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    body = new URLSearchParams(params).toString();
  }

  const res = await fetch(url, {
    method: httpMethod,
    headers: {
      Authorization: authHeader,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });

  const data = (await res.json()) as NovofonApiResponse;

  if (data.status !== 'success') {
    throw new Error(data.message ?? `Novofon API error: ${method}`);
  }

  return data;
}

/**
 * Validate Novofon API credentials by checking balance.
 */
export async function validateCredentials(apiKey: string, apiSecret: string): Promise<void> {
  await novofonRequest(apiKey, apiSecret, '/v1/info/balance/');
}

/**
 * Connect a new Novofon account: validate credentials, store, configure webhook.
 */
export async function connectAccount(
  apiKey: string,
  apiSecret: string,
  sipLogin: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // Validate credentials
  await validateCredentials(apiKey, apiSecret);

  // Check for duplicate
  const existing = store.findOne('novofonAccounts', (r) => r.apiKey === apiKey);
  if (existing) {
    throw new Error('This Novofon account is already connected');
  }

  // Get account name from balance info
  let accountName: string | null = null;
  try {
    const info = await novofonRequest(apiKey, apiSecret, '/v1/info/balance/');
    accountName = (info.name as string) || null;
  } catch {
    // non-critical
  }

  // Configure webhook notifications if base URL is set
  let webhookConfigured = false;
  if (env.NOVOFON_WEBHOOK_BASE_URL) {
    try {
      const webhookUrl = `${env.NOVOFON_WEBHOOK_BASE_URL}/api/novofon/webhook`;
      await novofonRequest(apiKey, apiSecret, '/v1/pbx/redirection/', 'PUT', {
        status: 'on',
        type: 'http',
        url: webhookUrl,
      });
      webhookConfigured = true;
    } catch {
      // Store account anyway, webhook can be retried
    }
  }

  const account = store.insert('novofonAccounts', {
    apiKey,
    apiSecret,
    sipLogin,
    accountName,
    webhookConfigured,
    status: 'active',
    statusMessage: webhookConfigured ? null : 'Webhook not configured',
    createdById: audit?.userId ?? null,
  });

  if (audit?.userId) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'novofon_account',
      entityId: account.id as string,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(account);
}

/**
 * Disconnect (delete) a Novofon account.
 */
export async function disconnectAccount(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
): Promise<boolean> {
  const deleted = store.delete('novofonAccounts', id);
  if (!deleted) return false;

  if (audit?.userId) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'novofon_account',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return true;
}

/**
 * List all Novofon accounts (sanitized).
 */
export function listAccounts() {
  const accounts = store.getAll('novofonAccounts');
  return accounts.map(sanitizeAccount);
}

/**
 * Get a single Novofon account by ID (sanitized).
 */
export function getAccountById(id: string) {
  const account = store.getById('novofonAccounts', id);
  if (!account) return null;
  return sanitizeAccount(account);
}

/**
 * Get raw account by ID (with secrets — internal use only).
 */
export function getRawAccountById(id: string) {
  return store.getById('novofonAccounts', id);
}

/**
 * Mask sensitive fields for API responses.
 */
function sanitizeAccount(account: Record<string, unknown>) {
  const apiKey = account.apiKey as string;
  const apiSecret = account.apiSecret as string;
  return {
    ...account,
    apiKey: apiKey ? apiKey.slice(0, 6) + '***' : '',
    apiSecret: apiSecret ? '***' : '',
  };
}

/**
 * Request a call recording download link.
 */
export async function requestRecording(
  apiKey: string,
  apiSecret: string,
  callId: string,
  pbxCallId: string,
): Promise<string | null> {
  try {
    const data = await novofonRequest(apiKey, apiSecret, '/v1/pbx/record/request/', 'GET', {
      call_id: callId,
      pbx_call_id: pbxCallId,
    });
    return (data.link as string) || null;
  } catch {
    return null;
  }
}

/**
 * Get WebRTC key for browser-based calling (valid 72h).
 */
export async function getWebRtcKey(apiKey: string, apiSecret: string): Promise<string> {
  const data = await novofonRequest(apiKey, apiSecret, '/v1/webrtc/get_key/');
  return data.key as string;
}

/**
 * Initiate a callback (PBX dials the SIP user, then dials the destination).
 */
export async function initiateCallback(
  apiKey: string,
  apiSecret: string,
  sipLogin: string,
  phoneNumber: string,
): Promise<string> {
  const data = await novofonRequest(apiKey, apiSecret, '/v1/pbx/callback/', 'POST', {
    from: sipLogin,
    to: phoneNumber,
  });
  return (data.call_id as string) || '';
}
