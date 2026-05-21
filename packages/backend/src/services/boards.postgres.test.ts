import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { SqlStoreAdapter } from '../db/sql-store-adapter.js';

const sqlDatabaseUrl = process.env.STORE_CONTRACT_DATABASE_URL ?? process.env.DATABASE_URL;
const testDir = path.dirname(fileURLToPath(import.meta.url));

describe('deleteBoard Postgres lifecycle', () => {
  it.skipIf(!sqlDatabaseUrl)(
    'deletes board cards, cron templates, and columns before the board',
    async () => {
      if (!(await canConnectToPostgres(sqlDatabaseUrl!))) {
        console.warn('Skipping Postgres board delete lifecycle test: configured database is unavailable.');
        return;
      }

      await withTemporaryPostgresDatabase(sqlDatabaseUrl!, async (databaseUrl) => {
        vi.resetModules();

        const store = new SqlStoreAdapter({
          driver: 'postgres',
          databaseUrl,
          migrationsDir: './drizzle',
          migrationsTable: '__drizzle_migrations',
          migrationsSchema: 'drizzle',
        });

        await store.init();

        vi.doMock('../db/index.js', () => ({ store }));
        vi.doMock('../db/connection.js', () => ({ store }));
        vi.doMock('./audit-log.js', () => ({ createAuditLog: vi.fn() }));
        vi.doMock('./collections.js', () => ({
          getOrCreateGeneralCollection: vi.fn(async () => ({ id: 'collection-general' })),
        }));
        vi.doMock('./cards.js', () => ({ updateCard: vi.fn() }));

        try {
          const { deleteBoard } = await import('./boards.js');

          await store.insert('users', {
            id: 'user-1',
            email: 'user-1@example.test',
            passwordHash: 'hash',
            firstName: 'User',
            lastName: 'One',
            type: 'human',
            isActive: true,
            totpSecret: null,
            totpEnabled: false,
            recoveryCodes: null,
          });
          await store.insert('collections', {
            id: 'collection-1',
            name: 'Collection',
            description: null,
            isGeneral: false,
            createdById: 'user-1',
          });
          await store.insert('boards', {
            id: 'board-1',
            name: 'Board',
            description: null,
            collectionId: 'collection-1',
            defaultCollectionId: 'collection-1',
            isGeneral: false,
            createdById: 'user-1',
          });
          await store.insert('boardColumns', {
            id: 'column-1',
            boardId: 'board-1',
            name: 'Todo',
            color: '#6B7280',
            position: 0,
          });
          await store.insert('cards', {
            id: 'card-1',
            collectionId: 'collection-1',
            name: 'Card',
            description: null,
            customFields: {},
            createdById: 'user-1',
            assigneeId: null,
            position: 0,
          });
          await store.insert('boardCards', {
            id: 'board-card-1',
            boardId: 'board-1',
            cardId: 'card-1',
            columnId: 'column-1',
            position: 0,
          });
          await store.insert('boardCronTemplates', {
            id: 'template-1',
            boardId: 'board-1',
            columnId: 'column-1',
            name: 'Scheduled card',
            cron: '0 9 * * *',
            enabled: true,
            createdById: 'user-1',
          });

          await expect(deleteBoard('board-1')).resolves.toMatchObject({ id: 'board-1' });

          expect(store.getById('boards', 'board-1')).toBeNull();
          expect(store.getAll('boardCards').filter((row) => row.boardId === 'board-1')).toEqual([]);
          expect(store.getAll('boardColumns').filter((row) => row.boardId === 'board-1')).toEqual([]);
          expect(store.getAll('boardCronTemplates').filter((row) => row.boardId === 'board-1')).toEqual(
            [],
          );
          expect(store.getById('cards', 'card-1')).toMatchObject({ id: 'card-1' });
        } finally {
          await closeStore(store);
          vi.doUnmock('../db/index.js');
          vi.doUnmock('../db/connection.js');
          vi.doUnmock('./audit-log.js');
          vi.doUnmock('./collections.js');
          vi.doUnmock('./cards.js');
          vi.resetModules();
        }
      });
    },
  );
});

async function canConnectToPostgres(baseDatabaseUrl: string): Promise<boolean> {
  const admin = postgres(databaseUrlForDatabase(baseDatabaseUrl, 'postgres'), { max: 1, prepare: false });
  try {
    await admin.unsafe('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

async function closeStore(store: SqlStoreAdapter): Promise<void> {
  const client = (store as unknown as { client?: { end?: () => Promise<void> } }).client;
  await client?.end?.();
}

async function withTemporaryPostgresDatabase(
  baseDatabaseUrl: string,
  run: (databaseUrl: string) => Promise<void>,
): Promise<void> {
  const tmpDatabase = `openwork_board_delete_${process.pid}_${Date.now()}`;
  const adminUrl = databaseUrlForDatabase(baseDatabaseUrl, 'postgres');
  const tmpDatabaseUrl = databaseUrlForDatabase(baseDatabaseUrl, tmpDatabase);
  const admin = postgres(adminUrl, { max: 1, prepare: false });

  try {
    await admin.unsafe(`create database "${tmpDatabase}"`);
    await migratePostgresDatabase(tmpDatabaseUrl);
    await run(tmpDatabaseUrl);
  } finally {
    await admin.unsafe(`drop database if exists "${tmpDatabase}" with (force)`);
    await admin.end();
  }
}

async function migratePostgresDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const migrationPath = path.resolve(testDir, '../../drizzle/0000_graceful_wiccan.sql');
  const migration = fs.readFileSync(migrationPath, 'utf-8');

  try {
    for (const statement of migration
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter(Boolean)) {
      await sql.unsafe(statement);
    }
  } finally {
    await sql.end();
  }
}

function databaseUrlForDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}
