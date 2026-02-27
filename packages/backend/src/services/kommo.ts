import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

// ── Rate limiter (token-bucket, 7 req/sec per subdomain) ───────────────────

const buckets = new Map<string, { tokens: number; lastRefill: number }>();
const MAX_TOKENS = 7;
const REFILL_INTERVAL_MS = 1000;

async function waitForToken(subdomain: string): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    let bucket = buckets.get(subdomain);
    if (!bucket) {
      bucket = { tokens: MAX_TOKENS, lastRefill: now };
      buckets.set(subdomain, bucket);
    }

    const elapsed = now - bucket.lastRefill;
    if (elapsed >= REFILL_INTERVAL_MS) {
      bucket.tokens = MAX_TOKENS;
      bucket.lastRefill = now;
    }

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return;
    }

    const waitMs = REFILL_INTERVAL_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// ── Kommo API helpers ──────────────────────────────────────────────────────

interface KommoRequestOptions {
  subdomain: string;
  accessToken: string;
  endpoint: string;
  params?: Record<string, string>;
}

async function kommoRequest<T>(opts: KommoRequestOptions): Promise<T> {
  await waitForToken(opts.subdomain);

  const url = new URL(`https://${opts.subdomain}.amocrm.ru/api/v4${opts.endpoint}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });

  if (res.status === 204) return {} as T;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kommo API ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

async function kommoGetPaginated<T>(
  subdomain: string,
  accessToken: string,
  endpoint: string,
  params?: Record<string, string>,
  limit = 250,
  maxPages = 10,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (page <= maxPages) {
    const allParams: Record<string, string> = {
      ...params,
      limit: String(limit),
      page: String(page),
    };

    const json = await kommoRequest<Record<string, unknown>>({
      subdomain,
      accessToken,
      endpoint,
      params: allParams,
    });

    const embedded = json._embedded as Record<string, T[]> | undefined;
    if (!embedded) break;

    const key = Object.keys(embedded)[0];
    const batch = embedded[key];
    if (!batch || batch.length === 0) break;

    items.push(...batch);
    if (batch.length < limit) break;
    page++;
  }

  return items;
}

// ── Credential validation ──────────────────────────────────────────────────

interface KommoAccountInfo {
  id: number;
  name: string;
}

async function validateKommoCredentials(
  subdomain: string,
  accessToken: string,
): Promise<KommoAccountInfo> {
  const data = await kommoRequest<KommoAccountInfo>({
    subdomain,
    accessToken,
    endpoint: '/account',
  });

  if (!data || !data.id) {
    throw new Error('Invalid response from amoCRM — could not verify account');
  }

  return data;
}

// ── Account CRUD ───────────────────────────────────────────────────────────

interface AuditInfo {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function connectKommoAccount(
  subdomain: string,
  accessToken: string,
  audit?: AuditInfo,
) {
  // Validate credentials first
  const accountInfo = await validateKommoCredentials(subdomain, accessToken);

  // Check for duplicate
  const existing = store.findOne('kommoAccounts', (r) => r.subdomain === subdomain);
  if (existing) {
    throw new Error('This amoCRM account is already connected');
  }

  const now = new Date().toISOString();
  const account = store.insert('kommoAccounts', {
    subdomain,
    accessToken,
    accountName: accountInfo.name || null,
    accountId: accountInfo.id || null,
    status: 'active',
    statusMessage: null,
    createdById: audit?.userId || null,
    createdAt: now,
    updatedAt: now,
  });

  if (audit?.userId) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'kommo_account',
      entityId: account.id as string,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(account);
}

export function getKommoAccount() {
  const accounts = store.getAll('kommoAccounts');
  if (accounts.length === 0) return null;
  return sanitizeAccount(accounts[0]);
}

function getRawKommoAccount() {
  const accounts = store.getAll('kommoAccounts');
  if (accounts.length === 0) return null;
  return accounts[0];
}

export async function disconnectKommoAccount(audit?: AuditInfo): Promise<boolean> {
  const account = getRawKommoAccount();
  if (!account) return false;

  const id = account.id as string;
  const deleted = store.delete('kommoAccounts', id);
  if (!deleted) return false;

  if (audit?.userId) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'kommo_account',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return true;
}

// ── Proxy methods ──────────────────────────────────────────────────────────

function requireAccount() {
  const account = getRawKommoAccount();
  if (!account) throw new Error('amoCRM account is not connected');
  return { subdomain: account.subdomain as string, accessToken: account.accessToken as string };
}

export async function listKommoContacts(query?: string) {
  const { subdomain, accessToken } = requireAccount();
  const params: Record<string, string> = {};
  if (query) params.query = query;
  return kommoGetPaginated(subdomain, accessToken, '/contacts', params);
}

export async function listKommoContactNotes(contactId: number) {
  const { subdomain, accessToken } = requireAccount();
  return kommoGetPaginated(subdomain, accessToken, `/contacts/${contactId}/notes`);
}

export async function listKommoTalks() {
  const { subdomain, accessToken } = requireAccount();
  return kommoGetPaginated(subdomain, accessToken, '/talks');
}

export async function getKommoTalkMessages(talkId: number) {
  const { subdomain, accessToken } = requireAccount();
  return kommoGetPaginated(subdomain, accessToken, `/talks/${talkId}/messages`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sanitizeAccount(account: Record<string, unknown>) {
  const token = account.accessToken as string;
  return {
    ...account,
    accessToken: token ? token.slice(0, 8) + '***' : '***',
  };
}
