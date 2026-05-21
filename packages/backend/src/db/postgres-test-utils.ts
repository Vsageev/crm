import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const testDir = path.dirname(fileURLToPath(import.meta.url));

export interface TemporaryPostgresDatabase {
  databaseUrl: string;
  drop: () => Promise<void>;
}

export async function createTemporaryPostgresDatabase(
  baseDatabaseUrl: string,
  prefix: string,
): Promise<TemporaryPostgresDatabase> {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
  const tmpDatabase = `${safePrefix}_${process.pid}_${Date.now()}`;
  const adminUrl = databaseUrlForDatabase(baseDatabaseUrl, 'postgres');
  const databaseUrl = databaseUrlForDatabase(baseDatabaseUrl, tmpDatabase);
  const admin = postgres(adminUrl, { max: 1, prepare: false });

  await admin.unsafe(`create database "${tmpDatabase}"`);
  await admin.end();

  try {
    await migratePostgresDatabase(databaseUrl);
  } catch (error) {
    const cleanupAdmin = postgres(adminUrl, { max: 1, prepare: false });
    try {
      await cleanupAdmin.unsafe(`drop database if exists "${tmpDatabase}" with (force)`);
    } finally {
      await cleanupAdmin.end();
    }
    throw error;
  }

  return {
    databaseUrl,
    async drop() {
      const dropAdmin = postgres(adminUrl, { max: 1, prepare: false });
      try {
        await dropAdmin.unsafe(`drop database if exists "${tmpDatabase}" with (force)`);
      } finally {
        await dropAdmin.end();
      }
    },
  };
}

async function migratePostgresDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const migrationsDir = path.resolve(testDir, '../../drizzle');
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  try {
    for (const name of migrationFiles) {
      const migration = fs.readFileSync(path.join(migrationsDir, name), 'utf-8');
      for (const statement of splitMigrationStatements(migration)) {
        await sql.unsafe(statement);
      }
    }
  } finally {
    await sql.end();
  }
}

function splitMigrationStatements(migration: string): string[] {
  return migration
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);
}

function databaseUrlForDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}
