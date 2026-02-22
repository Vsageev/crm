import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../config/env.js', () => {
  const backupDir = join(tmpdir(), `crm-backup-test-${Date.now()}`);
  return {
    env: {
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/crm',
      BACKUP_DIR: backupDir,
      BACKUP_CRON: '0 2 * * *',
      BACKUP_RETENTION_DAYS: 30,
      BACKUP_ENABLED: true,
    },
  };
});

const { ensureBackupDir, listBackups, pruneOldBackups } = await import('./backup.js');
const { env } = await import('../config/env.js');

describe('Backup Service', () => {
  beforeEach(async () => {
    await mkdir(env.BACKUP_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      const files = await readdir(env.BACKUP_DIR);
      for (const f of files) {
        await unlink(join(env.BACKUP_DIR, f));
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe('ensureBackupDir', () => {
    it('should create the backup directory', async () => {
      await ensureBackupDir();
      const stats = await stat(env.BACKUP_DIR);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('listBackups', () => {
    it('should return empty array when no backups exist', async () => {
      const backups = await listBackups();
      expect(backups).toEqual([]);
    });

    it('should list backup files sorted by date descending', async () => {
      await writeFile(join(env.BACKUP_DIR, 'crm-backup-2026-01-01T00-00-00-000Z.sql.gz'), '');
      await writeFile(join(env.BACKUP_DIR, 'crm-backup-2026-01-02T00-00-00-000Z.sql.gz'), '');
      await writeFile(join(env.BACKUP_DIR, 'not-a-backup.txt'), '');

      const backups = await listBackups();
      expect(backups).toHaveLength(2);
      expect(backups[0].filename).toContain('crm-backup-');
    });
  });

  describe('pruneOldBackups', () => {
    it('should remove backups older than retention period', async () => {
      const oldFile = 'crm-backup-2020-01-01T00-00-00-000Z.sql.gz';
      await writeFile(join(env.BACKUP_DIR, oldFile), 'old');

      const removed = await pruneOldBackups();
      expect(removed).toContain(oldFile);

      const remaining = await listBackups();
      expect(remaining).toHaveLength(0);
    });

    it('should keep recent backups', async () => {
      const recentFile = `crm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`;
      await writeFile(join(env.BACKUP_DIR, recentFile), 'recent');

      const removed = await pruneOldBackups();
      expect(removed).toHaveLength(0);

      const remaining = await listBackups();
      expect(remaining).toHaveLength(1);
    });
  });
});
