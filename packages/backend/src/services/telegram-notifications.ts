import crypto from 'node:crypto';
import { store } from '../db/index.js';

const TELEGRAM_API = 'https://api.telegram.org';

/** How long a link token stays valid (15 minutes). */
const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getActiveBot() {
  const bot = store.findOne('telegramBots', r => r.status === 'active');
  return bot ?? null;
}

async function telegramSendMessage(
  token: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' = 'HTML',
): Promise<boolean> {
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Link token flow (pair CRM user ↔ Telegram chat)
// ---------------------------------------------------------------------------

/**
 * Generate a short-lived link token for a CRM user.
 * The user sends this token to the bot via /start to link their Telegram chat.
 */
export async function generateLinkToken(userId: string) {
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

  // Upsert: update link token if settings row already exists
  const existing = store.findOne('telegramNotificationSettings', r => r.userId === userId);

  if (existing) {
    store.update('telegramNotificationSettings', existing.id as string, {
      linkToken: token,
      linkTokenExpiresAt: expiresAt,
    });
  } else {
    // Create a placeholder row (chatId will be filled on /start)
    store.insert('telegramNotificationSettings', {
      userId,
      telegramChatId: '', // will be set during linking
      linkToken: token,
      linkTokenExpiresAt: expiresAt,
      enabled: false, // not active until linked
    });
  }

  return token;
}

/**
 * Called when the Telegram bot receives /start <token>.
 * Links the chat to the CRM user who owns the token.
 */
export async function linkTelegramChat(
  linkToken: string,
  chatId: string,
  username?: string,
) {
  const now = new Date();

  const settings = store.findOne('telegramNotificationSettings', r =>
    r.linkToken === linkToken &&
    new Date(r.linkTokenExpiresAt as string).getTime() > now.getTime(),
  );

  if (!settings) return null;

  const updated = store.update('telegramNotificationSettings', settings.id as string, {
    telegramChatId: chatId,
    telegramUsername: username ?? null,
    enabled: true,
    linkToken: null,
    linkTokenExpiresAt: null,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// CRUD for notification settings
// ---------------------------------------------------------------------------

export async function getSettingsByUserId(userId: string) {
  const settings = store.findOne('telegramNotificationSettings', r => r.userId === userId);
  return settings ?? null;
}

export interface UpdateNotificationSettingsData {
  enabled?: boolean;
  notifyNewLead?: boolean;
  notifyTaskDueSoon?: boolean;
  notifyTaskOverdue?: boolean;
  notifyDealStageChange?: boolean;
  notifyLeadAssigned?: boolean;
}

export async function updateSettings(userId: string, data: UpdateNotificationSettingsData) {
  const existing = store.findOne('telegramNotificationSettings', r => r.userId === userId);
  if (!existing) return null;

  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) setData[key] = value;
  }

  const updated = store.update('telegramNotificationSettings', existing.id as string, setData);
  return updated ?? null;
}

export async function unlinkTelegram(userId: string) {
  const existing = store.findOne('telegramNotificationSettings', r => r.userId === userId);
  if (!existing) return null;
  const deleted = store.delete('telegramNotificationSettings', existing.id as string);
  return deleted ?? null;
}

// ---------------------------------------------------------------------------
// Send notification messages
// ---------------------------------------------------------------------------

type NotificationType = 'notifyNewLead' | 'notifyTaskDueSoon' | 'notifyTaskOverdue' | 'notifyDealStageChange' | 'notifyLeadAssigned';

/**
 * Send a Telegram notification to a specific CRM user (by userId).
 * Returns true if the message was sent successfully.
 */
export async function sendTelegramNotification(
  userId: string,
  text: string,
  notificationType?: NotificationType,
): Promise<boolean> {
  // 1. Get the user's settings
  const settings = await getSettingsByUserId(userId);
  if (!settings || !settings.enabled || !settings.telegramChatId) return false;

  // 2. Check per-type toggle
  if (notificationType && !settings[notificationType]) return false;

  // 3. Get an active bot
  const bot = await getActiveBot();
  if (!bot) return false;

  // 4. Send
  return telegramSendMessage(bot.token as string, settings.telegramChatId as string, text);
}

/**
 * Send a Telegram notification to multiple users at once.
 * Fires all sends concurrently and returns which succeeded.
 */
export async function sendTelegramNotificationBatch(
  items: Array<{
    userId: string;
    text: string;
    notificationType?: NotificationType;
  }>,
): Promise<{ userId: string; sent: boolean }[]> {
  const results = await Promise.all(
    items.map(async (item) => {
      const sent = await sendTelegramNotification(item.userId, item.text, item.notificationType);
      return { userId: item.userId, sent };
    }),
  );
  return results;
}

/**
 * Get all users who have Telegram notifications enabled for a specific type.
 */
export async function getUsersWithNotificationType(
  notificationType: NotificationType,
) {
  const rows = store.find('telegramNotificationSettings', r =>
    r.enabled === true && r[notificationType] === true,
  );

  return rows
    .filter((r) => r.telegramChatId !== '')
    .map((r) => ({
      userId: r.userId as string,
      telegramChatId: r.telegramChatId as string,
    }));
}

// ---------------------------------------------------------------------------
// Formatted notification builders
// ---------------------------------------------------------------------------

export function formatNewLeadNotification(contact: {
  firstName: string;
  lastName?: string | null;
  source?: string | null;
}) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  const source = contact.source ? ` (${contact.source})` : '';
  return `🆕 <b>New lead</b>\n\n${name}${source}`;
}

export function formatLeadAssignedNotification(contact: {
  firstName: string;
  lastName?: string | null;
}, assignedTo: { firstName: string; lastName: string }) {
  const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  return `👤 <b>Lead assigned to you</b>\n\nContact: ${contactName}`;
}

export function formatTaskDueSoonNotification(task: {
  title: string;
  dueDate?: Date | null;
}) {
  const due = task.dueDate
    ? `\nDue: ${task.dueDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
    : '';
  return `⏰ <b>Task due soon</b>\n\n${task.title}${due}`;
}

export function formatTaskOverdueNotification(task: {
  title: string;
  dueDate?: Date | null;
}) {
  const due = task.dueDate
    ? `\nWas due: ${task.dueDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
    : '';
  return `🔴 <b>Task overdue</b>\n\n${task.title}${due}`;
}

export function formatDealStageChangeNotification(deal: {
  title: string;
  value?: string | null;
  currency?: string | null;
}, stageName: string) {
  const val = deal.value ? `\nValue: ${deal.value} ${deal.currency ?? ''}` : '';
  return `📊 <b>Deal stage changed</b>\n\n${deal.title}${val}\nNew stage: ${stageName}`;
}
