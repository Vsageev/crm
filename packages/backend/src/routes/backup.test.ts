import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';

const backupDir = join(tmpdir(), `crm-backup-route-test-${Date.now()}`);

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/crm',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGIN: 'http://localhost:5173',
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    BACKUP_DIR: backupDir,
    BACKUP_CRON: '0 2 * * *',
    BACKUP_RETENTION_DAYS: 30,
    BACKUP_ENABLED: false,
  },
}));

const { buildApp } = await import('../app.js');

describe('Backup Routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    await mkdir(backupDir, { recursive: true });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    try {
      const files = await readdir(backupDir);
      for (const f of files) {
        await unlink(join(backupDir, f));
      }
    } catch {
      // ignore
    }
  });

  describe('GET /api/backups', () => {
    it('should return empty list when no backups', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/backups' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(0);
      expect(body.backups).toEqual([]);
    });

    it('should list existing backup files', async () => {
      await writeFile(join(backupDir, 'crm-backup-2026-01-01T00-00-00-000Z.sql.gz'), 'data');

      const res = await app.inject({ method: 'GET', url: '/api/backups' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBe(1);
      expect(body.backups[0].filename).toBe('crm-backup-2026-01-01T00-00-00-000Z.sql.gz');
    });
  });

  describe('DELETE /api/backups/prune', () => {
    it('should prune old backups', async () => {
      await writeFile(join(backupDir, 'crm-backup-2020-01-01T00-00-00-000Z.sql.gz'), 'old');

      const res = await app.inject({ method: 'DELETE', url: '/api/backups/prune' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.removed).toHaveLength(1);
    });
  });
});
