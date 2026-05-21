import { asc, eq } from 'drizzle-orm';
import { store } from '../connection.js';
import * as schema from '../schema.js';
import type { StoreRecord } from '../store.js';
import { getFlushedNativeDb, recordFromLegacyRow, recordsFromLegacyRows } from './native-repository-utils.js';

export async function findFirstActiveTelegramBot(): Promise<StoreRecord | null> {
  const db = await getFlushedNativeDb();
  if (!db) {
    return store.getAll('telegramBots').find((b) => b.status === 'active') ?? null;
  }
  const rows = await db
    .select()
    .from(schema.telegramBots)
    .where(eq(schema.telegramBots.status, 'active'))
    .orderBy(asc(schema.telegramBots.createdAt))
    .limit(1);
  return rows[0] ? recordFromLegacyRow(rows[0]) : null;
}

export async function getTelegramBotRecordById(id: string): Promise<StoreRecord | null> {
  const db = await getFlushedNativeDb();
  if (!db) return store.getById('telegramBots', id);
  const rows = await db
    .select()
    .from(schema.telegramBots)
    .where(eq(schema.telegramBots.id, id))
    .limit(1);
  return rows[0] ? recordFromLegacyRow(rows[0]) : null;
}

export async function findTelegramBotByBotId(botId: string): Promise<StoreRecord | null> {
  const db = await getFlushedNativeDb();
  if (!db) {
    return store.getAll('telegramBots').find((r) => r.botId === botId) ?? null;
  }
  const rows = await db
    .select()
    .from(schema.telegramBots)
    .where(eq(schema.telegramBots.botId, botId))
    .limit(1);
  return rows[0] ? recordFromLegacyRow(rows[0]) : null;
}

export async function listAllTelegramBotRecords(): Promise<StoreRecord[]> {
  const db = await getFlushedNativeDb();
  if (!db) return store.getAll('telegramBots');
  const rows = await db.select().from(schema.telegramBots).orderBy(asc(schema.telegramBots.createdAt));
  return recordsFromLegacyRows(rows);
}
