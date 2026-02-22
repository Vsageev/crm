import { mkdir, readdir, stat, unlink, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';

export interface BackupResult {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: Date;
}

const DATA_DIR = resolve('./data');

function getBackupDir(): string {
  return resolve(env.BACKUP_DIR);
}

function buildSubdirName(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return `crm-backup-${ts}`;
}

function parseTimestampFromDirname(dirname: string): Date | null {
  const match = dirname.match(/^crm-backup-(.+)$/);
  if (!match) return null;
  const isoStr = match[1].replace(/(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, '$1:$2:$3.$4Z');
  const date = new Date(isoStr);
  return isNaN(date.getTime()) ? null : date;
}

export async function ensureBackupDir(): Promise<void> {
  await mkdir(getBackupDir(), { recursive: true });
}

export async function createBackup(): Promise<BackupResult> {
  const dir = getBackupDir();
  await ensureBackupDir();

  const subdirName = buildSubdirName();
  const subdirPath = join(dir, subdirName);
  await mkdir(subdirPath, { recursive: true });

  // Copy all JSON files from data directory
  let totalSize = 0;
  try {
    const dataFiles = await readdir(DATA_DIR);
    const jsonFiles = dataFiles.filter((f) => f.endsWith('.json'));

    for (const file of jsonFiles) {
      const src = join(DATA_DIR, file);
      const dest = join(subdirPath, file);
      await copyFile(src, dest);
      const fileInfo = await stat(dest);
      totalSize += fileInfo.size;
    }
  } catch (err) {
    // If data dir doesn't exist or is empty, create an empty backup
    console.warn('Warning: could not read data directory:', err);
  }

  return {
    filename: subdirName,
    path: subdirPath,
    sizeBytes: totalSize,
    createdAt: new Date(),
  };
}

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = getBackupDir();
  await ensureBackupDir();

  const entries = await readdir(dir, { withFileTypes: true });
  const backupDirs = entries.filter(
    (e) => e.isDirectory() && e.name.startsWith('crm-backup-'),
  );

  const results: BackupInfo[] = [];
  for (const entry of backupDirs) {
    const entryPath = join(dir, entry.name);
    const entryInfo = await stat(entryPath);

    // Calculate total size of all files in the backup subdirectory
    let totalSize = 0;
    try {
      const files = await readdir(entryPath);
      for (const file of files) {
        const fileInfo = await stat(join(entryPath, file));
        totalSize += fileInfo.size;
      }
    } catch {
      // ignore errors reading individual backup contents
    }

    const createdAt = parseTimestampFromDirname(entry.name) ?? entryInfo.birthtime;
    results.push({
      filename: entry.name,
      sizeBytes: totalSize,
      createdAt,
    });
  }

  return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function pruneOldBackups(): Promise<string[]> {
  const dir = getBackupDir();
  const backups = await listBackups();
  const cutoff = Date.now() - env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const backup of backups) {
    if (backup.createdAt.getTime() < cutoff) {
      const backupPath = join(dir, backup.filename);
      // Remove all files in the backup subdirectory, then remove the directory
      try {
        const files = await readdir(backupPath);
        for (const file of files) {
          await unlink(join(backupPath, file));
        }
        const { rmdir } = await import('node:fs/promises');
        await rmdir(backupPath);
      } catch {
        // best-effort removal
      }
      removed.push(backup.filename);
    }
  }

  return removed;
}
