import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { createBackup, pruneOldBackups } from '../services/backup.js';

let scheduledTask: cron.ScheduledTask | null = null;

export async function registerBackupScheduler(app: FastifyInstance) {
  if (!env.BACKUP_ENABLED) {
    app.log.info('Database backup scheduler is disabled');
    return;
  }

  if (!cron.validate(env.BACKUP_CRON)) {
    app.log.error(`Invalid BACKUP_CRON expression: ${env.BACKUP_CRON}`);
    return;
  }

  scheduledTask = cron.schedule(env.BACKUP_CRON, async () => {
    app.log.info('Starting scheduled database backup...');
    try {
      const result = await createBackup();
      app.log.info(
        `Backup completed: ${result.filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`,
      );

      const pruned = await pruneOldBackups();
      if (pruned.length > 0) {
        app.log.info(`Pruned ${pruned.length} old backup(s): ${pruned.join(', ')}`);
      }
    } catch (err) {
      app.log.error(err, 'Scheduled database backup failed');
    }
  });

  app.log.info(`Database backup scheduler started (cron: ${env.BACKUP_CRON})`);

  app.addHook('onClose', () => {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
    }
  });
}
