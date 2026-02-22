import cron from 'node-cron';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import {
  findTasksDueSoon,
  findOverdueTasks,
  createNotificationsBatch,
  hasRecentNotification,
} from '../services/notifications.js';
import {
  sendTelegramNotificationBatch,
  formatTaskDueSoonNotification,
  formatTaskOverdueNotification,
} from '../services/telegram-notifications.js';
import { sendWebPushBatch } from '../services/web-push.js';

let scheduledTask: cron.ScheduledTask | null = null;

/** Hours before due date to send a "due soon" reminder */
const DUE_SOON_HOURS = 1;

/** Hours to look back when de-duplicating notifications */
const DEDUP_WINDOW_HOURS = 4;

/**
 * Processes upcoming and overdue tasks, creating notifications
 * for assignees who haven't been notified recently.
 */
async function processTaskReminders(log: FastifyInstance['log']) {
  // 1. Tasks due within the next hour
  const dueSoon = await findTasksDueSoon(DUE_SOON_HOURS);
  const dueSoonNotifications = [];
  const dueSoonTasks: typeof dueSoon = [];

  for (const task of dueSoon) {
    if (!task.assigneeId) continue;

    const alreadyNotified = await hasRecentNotification(
      task.assigneeId as string,
      'task_due_soon',
      task.id as string,
      DEDUP_WINDOW_HOURS,
    );
    if (alreadyNotified) continue;

    dueSoonNotifications.push({
      userId: task.assigneeId as string,
      type: 'task_due_soon' as const,
      title: `Task due soon: ${task.title}`,
      message: `Your task "${task.title}" is due within the next hour.`,
      entityType: 'task',
      entityId: task.id as string,
    });
    dueSoonTasks.push(task);
  }

  if (dueSoonNotifications.length > 0) {
    await createNotificationsBatch(dueSoonNotifications);
    log.info(`Created ${dueSoonNotifications.length} due-soon notification(s)`);

    // Send Telegram notifications for due-soon tasks
    const tgDueSoon = dueSoonTasks.map((task) => ({
      userId: task.assigneeId as string,
      text: formatTaskDueSoonNotification({ title: task.title as string, dueDate: task.dueDate ? new Date(task.dueDate as string) : null }),
      notificationType: 'notifyTaskDueSoon' as const,
    }));
    const tgResults = await sendTelegramNotificationBatch(tgDueSoon);
    const tgSent = tgResults.filter((r) => r.sent).length;
    if (tgSent > 0) log.info(`Sent ${tgSent} Telegram due-soon notification(s)`);

    // Send web push notifications for due-soon tasks
    const wpDueSoon = dueSoonTasks
      .filter((t) => t.assigneeId)
      .map((task) => ({
        userId: task.assigneeId as string,
        payload: {
          title: 'Task Due Soon',
          body: `"${task.title}" is due within the next hour`,
          tag: `task-due-${task.id}`,
          data: { url: `/tasks/${task.id}` },
        },
      }));
    const wpResults = await sendWebPushBatch(wpDueSoon);
    const wpSent = wpResults.reduce((sum, r) => sum + r.sent, 0);
    if (wpSent > 0) log.info(`Sent ${wpSent} web push due-soon notification(s)`);
  }

  // 2. Overdue tasks
  const overdue = await findOverdueTasks();
  const overdueNotifications = [];
  const overdueTasks: typeof overdue = [];

  for (const task of overdue) {
    if (!task.assigneeId) continue;

    const alreadyNotified = await hasRecentNotification(
      task.assigneeId as string,
      'task_overdue',
      task.id as string,
      DEDUP_WINDOW_HOURS,
    );
    if (alreadyNotified) continue;

    overdueNotifications.push({
      userId: task.assigneeId as string,
      type: 'task_overdue' as const,
      title: `Task overdue: ${task.title}`,
      message: `Your task "${task.title}" is past its due date.`,
      entityType: 'task',
      entityId: task.id as string,
    });
    overdueTasks.push(task);
  }

  if (overdueNotifications.length > 0) {
    await createNotificationsBatch(overdueNotifications);
    log.info(`Created ${overdueNotifications.length} overdue notification(s)`);

    // Send Telegram notifications for overdue tasks
    const tgOverdue = overdueTasks.map((task) => ({
      userId: task.assigneeId as string,
      text: formatTaskOverdueNotification({ title: task.title as string, dueDate: task.dueDate ? new Date(task.dueDate as string) : null }),
      notificationType: 'notifyTaskOverdue' as const,
    }));
    const tgOverdueResults = await sendTelegramNotificationBatch(tgOverdue);
    const tgOverdueSent = tgOverdueResults.filter((r) => r.sent).length;
    if (tgOverdueSent > 0) log.info(`Sent ${tgOverdueSent} Telegram overdue notification(s)`);

    // Send web push notifications for overdue tasks
    const wpOverdue = overdueTasks
      .filter((t) => t.assigneeId)
      .map((task) => ({
        userId: task.assigneeId as string,
        payload: {
          title: 'Task Overdue',
          body: `"${task.title}" is past its due date`,
          tag: `task-overdue-${task.id}`,
          data: { url: `/tasks/${task.id}` },
        },
      }));
    const wpOverdueResults = await sendWebPushBatch(wpOverdue);
    const wpOverdueSent = wpOverdueResults.reduce((sum, r) => sum + r.sent, 0);
    if (wpOverdueSent > 0) log.info(`Sent ${wpOverdueSent} web push overdue notification(s)`);
  }
}

export async function registerNotificationScheduler(app: FastifyInstance) {
  if (!env.NOTIFICATION_CRON_ENABLED) {
    app.log.info('Notification scheduler is disabled');
    return;
  }

  const cronExpr = env.NOTIFICATION_CRON;

  if (!cron.validate(cronExpr)) {
    app.log.error(`Invalid NOTIFICATION_CRON expression: ${cronExpr}`);
    return;
  }

  scheduledTask = cron.schedule(cronExpr, async () => {
    app.log.info('Running task reminder check...');
    try {
      await processTaskReminders(app.log);
    } catch (err) {
      app.log.error(err, 'Task reminder check failed');
    }
  });

  app.log.info(`Notification scheduler started (cron: ${cronExpr})`);

  app.addHook('onClose', () => {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
    }
  });
}
