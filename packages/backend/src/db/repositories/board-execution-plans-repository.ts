import { asc, eq } from 'drizzle-orm';
import { store } from '../connection.js';
import * as schema from '../schema.js';
import type { StoreRecord } from '../store.js';
import { getFlushedNativeDb, recordFromLegacyRow, recordsFromLegacyRows } from './native-repository-utils.js';

const COLLECTION = 'boardExecutionPlans';

export async function listBoardExecutionPlansForBoard(boardId: string): Promise<StoreRecord[]> {
  const db = await getFlushedNativeDb();
  if (!db) {
    return store.getAll(COLLECTION).filter((record) => record.boardId === boardId);
  }

  const rows = await db
    .select()
    .from(schema.boardExecutionPlans)
    .where(eq(schema.boardExecutionPlans.boardId, boardId))
    .orderBy(asc(schema.boardExecutionPlans.updatedAt));
  return recordsFromLegacyRows(rows);
}

export async function getBoardExecutionPlanRecordById(id: string): Promise<StoreRecord | null> {
  const db = await getFlushedNativeDb();
  if (!db) return store.getById(COLLECTION, id);

  const rows = await db
    .select()
    .from(schema.boardExecutionPlans)
    .where(eq(schema.boardExecutionPlans.id, id))
    .limit(1);
  return rows[0] ? recordFromLegacyRow(rows[0]) : null;
}

export async function deleteBoardExecutionPlansForBoard(boardId: string): Promise<StoreRecord[]> {
  const db = await getFlushedNativeDb();
  if (!db) {
    const removed: StoreRecord[] = [];
    for (const record of store.getAll(COLLECTION)) {
      if (record.boardId !== boardId || typeof record.id !== 'string') continue;
      const deleted = await store.delete(COLLECTION, record.id);
      if (deleted) removed.push(deleted);
    }
    return removed;
  }

  const rows = await db
    .delete(schema.boardExecutionPlans)
    .where(eq(schema.boardExecutionPlans.boardId, boardId))
    .returning();
  return recordsFromLegacyRows(rows);
}
