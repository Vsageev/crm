import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectEmailAccountData {
  email: string;
  name?: string;
  imapHost: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUsername: string;
  smtpPassword: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate SMTP credentials by attempting to connect and verify.
 * STUB: nodemailer removed for prototyping — always succeeds.
 */
async function validateSmtp(_data: ConnectEmailAccountData): Promise<void> {
  console.log('[email] SMTP validation skipped (nodemailer removed for prototyping)');
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Connect a new email account: validate SMTP, store in DB.
 */
export async function connectEmailAccount(
  data: ConnectEmailAccountData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // 1. Validate SMTP credentials
  let status: 'active' | 'inactive' | 'error' = 'inactive';
  let statusMessage: string | null = null;

  try {
    await validateSmtp(data);
    status = 'active';
  } catch (err) {
    status = 'error';
    statusMessage = err instanceof Error ? err.message : 'Failed to validate SMTP credentials';
  }

  // 2. Store in DB
  const account = store.insert('emailAccounts', {
    email: data.email,
    name: data.name,
    imapHost: data.imapHost,
    imapPort: data.imapPort ?? 993,
    imapSecure: data.imapSecure ?? true,
    imapUsername: data.imapUsername,
    imapPassword: data.imapPassword,
    smtpHost: data.smtpHost,
    smtpPort: data.smtpPort ?? 587,
    smtpSecure: data.smtpSecure ?? false,
    smtpUsername: data.smtpUsername,
    smtpPassword: data.smtpPassword,
    status,
    statusMessage,
    createdById: audit?.userId,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'email_account',
      entityId: account.id as string,
      changes: { email: data.email, status },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(account);
}

/**
 * Disconnect (delete) an email account.
 */
export async function disconnectEmailAccount(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('emailAccounts', id);
  if (!deleted) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'email_account',
      entityId: id,
      changes: { email: deleted.email },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(deleted);
}

/**
 * List all connected email accounts.
 */
export async function listEmailAccounts() {
  const accounts = store.getAll('emailAccounts');
  return accounts.map(sanitizeAccount);
}

/**
 * Get a single email account by ID.
 */
export async function getEmailAccountById(id: string) {
  const account = store.getById('emailAccounts', id);
  if (!account) return null;
  return sanitizeAccount(account);
}

/**
 * Get a raw email account (with passwords) for internal use (IMAP/SMTP).
 */
export async function getEmailAccountRaw(id: string) {
  return store.getById('emailAccounts', id);
}

/**
 * Get all active email accounts (for sync scheduler).
 */
export async function getActiveEmailAccounts() {
  return store.find('emailAccounts', (r) => r.status === 'active');
}

/**
 * Update the sync state for an email account after successful IMAP sync.
 */
export async function updateSyncState(id: string, lastSyncedUid: number) {
  store.update('emailAccounts', id, {
    lastSyncedUid,
    lastSyncedAt: new Date(),
    status: 'active',
    statusMessage: null,
    updatedAt: new Date(),
  });
}

/**
 * Mark an email account as errored (e.g. IMAP connection failure).
 */
export async function markAccountError(id: string, message: string) {
  store.update('emailAccounts', id, {
    status: 'error',
    statusMessage: message,
    updatedAt: new Date(),
  });
}

/**
 * Re-test SMTP connection for an existing account.
 */
export async function testEmailAccount(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const account = store.getById('emailAccounts', id);
  if (!account) return null;

  let status: 'active' | 'error' = 'active';
  let statusMessage: string | null = null;

  try {
    await validateSmtp({
      email: account.email as string,
      smtpHost: account.smtpHost as string,
      smtpPort: account.smtpPort as number,
      smtpSecure: account.smtpSecure as boolean,
      smtpUsername: account.smtpUsername as string,
      smtpPassword: account.smtpPassword as string,
      imapHost: account.imapHost as string,
      imapPort: account.imapPort as number,
      imapSecure: account.imapSecure as boolean,
      imapUsername: account.imapUsername as string,
      imapPassword: account.imapPassword as string,
    });
  } catch (err) {
    status = 'error';
    statusMessage = err instanceof Error ? err.message : 'SMTP validation failed';
  }

  const updated = store.update('emailAccounts', id, { status, statusMessage, updatedAt: new Date() });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'email_account',
      entityId: id,
      changes: { status, statusMessage },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeAccount(updated!);
}

// ---------------------------------------------------------------------------
// Sanitize — strip sensitive fields before returning to clients
// ---------------------------------------------------------------------------

function sanitizeAccount(account: Record<string, unknown>) {
  const { imapPassword, smtpPassword, ...safe } = account;
  return {
    ...safe,
    imapPasswordSet: ((imapPassword as string) ?? '').length > 0,
    smtpPasswordSet: ((smtpPassword as string) ?? '').length > 0,
  };
}
