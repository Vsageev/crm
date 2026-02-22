import crypto from 'node:crypto';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { createAuditLog } from './audit-log.js';

const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function telegramRequest<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;
  const options: RequestInit = {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(url, options);
  const data = (await res.json()) as TelegramApiResponse<T>;

  if (!data.ok) {
    throw new Error(data.description ?? `Telegram API error: ${method}`);
  }

  return data.result!;
}

/**
 * Validate a bot token by calling Telegram's getMe endpoint.
 */
export async function validateBotToken(token: string): Promise<TelegramUser> {
  return telegramRequest<TelegramUser>(token, 'getMe');
}

/**
 * Register (set) the webhook URL for a Telegram bot.
 */
export async function setTelegramWebhook(
  token: string,
  webhookUrl: string,
  secret: string,
): Promise<void> {
  await telegramRequest(token, 'setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
  });
}

/**
 * Remove the webhook for a Telegram bot.
 */
export async function removeTelegramWebhook(token: string): Promise<void> {
  await telegramRequest(token, 'deleteWebhook');
}

/**
 * Connect a new Telegram bot: validate token, store in DB, register webhook.
 */
export async function connectBot(
  token: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // 1. Validate token with Telegram
  const botInfo = await validateBotToken(token);

  // 2. Check if this bot is already connected
  const existing = store.findOne('telegramBots', r => r.botId === String(botInfo.id));

  if (existing) {
    throw new Error(`Bot @${botInfo.username ?? botInfo.id} is already connected`);
  }

  // 3. Generate webhook secret
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  // 4. Build webhook URL
  let webhookUrl: string | null = null;
  if (env.TELEGRAM_WEBHOOK_BASE_URL) {
    webhookUrl = `${env.TELEGRAM_WEBHOOK_BASE_URL}/api/telegram/webhook/${botInfo.id}`;
  }

  // 5. Register webhook with Telegram (if base URL is configured)
  let status: 'active' | 'inactive' | 'error' = 'inactive';
  let statusMessage: string | null = null;

  if (webhookUrl) {
    try {
      await setTelegramWebhook(token, webhookUrl, webhookSecret);
      status = 'active';
    } catch (err) {
      status = 'error';
      statusMessage = err instanceof Error ? err.message : 'Failed to register webhook';
    }
  } else {
    statusMessage = 'TELEGRAM_WEBHOOK_BASE_URL not configured; webhook not registered';
  }

  // 6. Store bot in DB
  const bot = store.insert('telegramBots', {
    token,
    botId: String(botInfo.id),
    botUsername: botInfo.username ?? String(botInfo.id),
    botFirstName: botInfo.first_name,
    webhookUrl,
    webhookSecret,
    status,
    statusMessage,
    createdById: audit?.userId,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'telegram_bot',
      entityId: bot.id as string,
      changes: { botUsername: bot.botUsername, status },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return sanitizeBot(bot);
}

/**
 * Disconnect a Telegram bot: remove webhook, delete from DB.
 */
export async function disconnectBot(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const bot = store.getById('telegramBots', id);
  if (!bot) return null;

  // Remove webhook from Telegram
  try {
    await removeTelegramWebhook(bot.token as string);
  } catch {
    // Best effort — bot token may already be revoked
  }

  const deleted = store.delete('telegramBots', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'telegram_bot',
      entityId: id,
      changes: { botUsername: deleted.botUsername },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ? sanitizeBot(deleted) : null;
}

/**
 * List all connected Telegram bots.
 */
export async function listBots() {
  const bots = store.getAll('telegramBots');
  return bots.map(sanitizeBot);
}

/**
 * Get a single Telegram bot by ID.
 */
export async function getBotById(id: string) {
  const bot = store.getById('telegramBots', id);
  if (!bot) return null;
  return sanitizeBot(bot);
}

/**
 * Get a bot by its Telegram bot ID (for webhook routing).
 */
export async function getBotByTelegramId(botId: string) {
  const bot = store.findOne('telegramBots', r => r.botId === botId);
  return bot ?? null;
}

/**
 * Re-register the webhook for an existing bot (e.g. after URL change).
 */
export async function refreshWebhook(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const bot = store.getById('telegramBots', id);
  if (!bot) return null;

  if (!env.TELEGRAM_WEBHOOK_BASE_URL) {
    throw new Error('TELEGRAM_WEBHOOK_BASE_URL not configured');
  }

  const webhookUrl = `${env.TELEGRAM_WEBHOOK_BASE_URL}/api/telegram/webhook/${bot.botId}`;
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  let status: 'active' | 'inactive' | 'error' = 'inactive';
  let statusMessage: string | null = null;

  try {
    await setTelegramWebhook(bot.token as string, webhookUrl, webhookSecret);
    status = 'active';
  } catch (err) {
    status = 'error';
    statusMessage = err instanceof Error ? err.message : 'Failed to register webhook';
  }

  const updated = store.update('telegramBots', id, { webhookUrl, webhookSecret, status, statusMessage });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'telegram_bot',
      entityId: id,
      changes: { webhookUrl, status },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated ? sanitizeBot(updated) : null;
}

/**
 * Get file info from Telegram (for downloading media).
 * Returns the file path that can be used to construct a download URL.
 */
export async function getFileInfo(
  token: string,
  fileId: string,
): Promise<{ file_id: string; file_unique_id: string; file_size?: number; file_path?: string }> {
  return telegramRequest(token, 'getFile', { file_id: fileId });
}

/**
 * Build a download URL for a Telegram file.
 */
export function buildFileUrl(token: string, filePath: string): string {
  return `${TELEGRAM_API}/file/bot${token}/${filePath}`;
}

/**
 * Update auto-greeting settings for a bot.
 */
export async function updateAutoGreeting(
  id: string,
  data: { enabled: boolean; text?: string | null },
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const bot = store.getById('telegramBots', id);
  if (!bot) return null;

  const updated = store.update('telegramBots', id, {
    autoGreetingEnabled: data.enabled,
    autoGreetingText: data.text ?? null,
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'telegram_bot',
      entityId: id,
      changes: { autoGreetingEnabled: data.enabled, autoGreetingText: data.text },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated ? sanitizeBot(updated) : null;
}

/**
 * Strip the token from bot objects before returning to clients.
 */
function sanitizeBot(bot: Record<string, unknown>) {
  const { token, webhookSecret, ...safe } = bot;
  return { ...safe, tokenMasked: `${(token as string).slice(0, 5)}...${(token as string).slice(-4)}` };
}
