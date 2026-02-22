import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { getActiveEmailAccounts } from '../services/email.js';
import { syncEmailAccount } from '../services/email-inbound.js';

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Sync all active email accounts by polling IMAP for new messages.
 */
async function syncAllAccounts(log: FastifyInstance['log']) {
  const accounts = await getActiveEmailAccounts();

  if (accounts.length === 0) return;

  for (const account of accounts) {
    try {
      const result = await syncEmailAccount(account.id as string);
      if (result.synced > 0) {
        log.info(`Email sync: ${account.email} — ${result.synced} new message(s)`);
      }
    } catch (err) {
      log.error(err, `Email sync failed for ${account.email}`);
    }
  }
}

export async function registerEmailSyncScheduler(app: FastifyInstance) {
  if (!env.EMAIL_SYNC_ENABLED) {
    app.log.info('Email sync scheduler is disabled');
    return;
  }

  const cronExpr = env.EMAIL_SYNC_CRON;

  if (!cron.validate(cronExpr)) {
    app.log.error(`Invalid EMAIL_SYNC_CRON expression: ${cronExpr}`);
    return;
  }

  scheduledTask = cron.schedule(cronExpr, async () => {
    try {
      await syncAllAccounts(app.log);
    } catch (err) {
      app.log.error(err, 'Email sync cycle failed');
    }
  });

  app.log.info(`Email sync scheduler started (cron: ${cronExpr})`);

  app.addHook('onClose', () => {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
    }
  });
}
