import fs from 'node:fs';
import type { SecureContextOptions } from 'node:tls';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import { env } from './config/env.js';
import { store } from './db/index.js';
import { registerCors } from './plugins/cors.js';
import { registerJwt } from './plugins/jwt.js';
import { registerBackupScheduler } from './plugins/backup-scheduler.js';
import { registerNotificationScheduler } from './plugins/notification-scheduler.js';
import { registerEmailSyncScheduler } from './plugins/email-sync-scheduler.js';
import { healthRoutes } from './routes/health.js';
import { backupRoutes } from './routes/backup.js';
import { authRoutes } from './routes/auth.js';
import { auditLogRoutes } from './routes/audit-logs.js';
import { contactRoutes } from './routes/contacts.js';
import { companyRoutes } from './routes/companies.js';
import { tagRoutes } from './routes/tags.js';
import { conversationRoutes } from './routes/conversations.js';
import { messageRoutes } from './routes/messages.js';
import { telegramRoutes } from './routes/telegram.js';
import { pipelineRoutes } from './routes/pipelines.js';
import { dealRoutes } from './routes/deals.js';
import { quickReplyTemplateRoutes } from './routes/quick-reply-templates.js';
import { taskRoutes } from './routes/tasks.js';
import { activityLogRoutes } from './routes/activity-logs.js';
import { notificationRoutes } from './routes/notifications.js';
import { telegramNotificationRoutes } from './routes/telegram-notifications.js';
import { telegramMessageTemplateRoutes } from './routes/telegram-message-templates.js';
import { webFormRoutes } from './routes/web-forms.js';
import { mediaRoutes } from './routes/media.js';
import { chatbotFlowRoutes } from './routes/chatbot-flows.js';
import { automationRuleRoutes } from './routes/automation-rules.js';
import { widgetRoutes } from './routes/widget.js';
import { reportRoutes } from './routes/reports.js';
import { publicApiRoutes } from './routes/public-api.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { webhookRoutes } from './routes/webhooks.js';
import { emailRoutes } from './routes/email.js';
import { registerSwagger } from './plugins/swagger.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerHelmet } from './plugins/helmet.js';
import { registerSanitization } from './middleware/sanitize.js';
import { registerSecurityMiddleware } from './middleware/security.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { initAutomationEngine } from './services/automation-engine.js';
import { initWebhookDeliveryEngine } from './services/webhook-delivery.js';
import { initWebPushEngine } from './services/web-push-engine.js';
import { webPushRoutes } from './routes/web-push.js';
import { webChatRoutes } from './routes/web-chat.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { instagramRoutes } from './routes/instagram.js';
import { novofonRoutes } from './routes/novofon.js';
import { voximplantRoutes } from './routes/voximplant.js';
import { telephonyRoutes } from './routes/telephony.js';
import { knowledgeBaseRoutes } from './routes/knowledge-base.js';
import { quizRoutes } from './routes/quizzes.js';
import { batchRoutes } from './routes/batch.js';
import { messageDraftRoutes } from './routes/message-drafts.js';
import { kommoRoutes } from './routes/kommo.js';
import { registerIdempotency } from './middleware/idempotency.js';

function buildHttpsOptions(): SecureContextOptions | undefined {
  if (!env.TLS_CERT_PATH || !env.TLS_KEY_PATH) return undefined;

  return {
    cert: fs.readFileSync(env.TLS_CERT_PATH),
    key: fs.readFileSync(env.TLS_KEY_PATH),
  };
}

export async function buildApp() {
  const https = buildHttpsOptions();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    ...(https ? { https } : {}),
  });

  // Initialize JSON store before anything else
  await store.init();

  await app.register(sensible);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await registerCors(app);
  await registerJwt(app);
  await registerHelmet(app);
  await registerRateLimit(app);
  registerSanitization(app);
  registerSecurityMiddleware(app);
  registerErrorHandler(app);
  registerIdempotency(app);

  // Plugins
  await registerSwagger(app);
  await registerBackupScheduler(app);
  await registerNotificationScheduler(app);
  await registerEmailSyncScheduler(app);
  initAutomationEngine();
  initWebhookDeliveryEngine();
  initWebPushEngine();

  // Routes
  await app.register(healthRoutes);
  await app.register(backupRoutes);
  await app.register(authRoutes);
  await app.register(auditLogRoutes);
  await app.register(contactRoutes);
  await app.register(companyRoutes);
  await app.register(tagRoutes);
  await app.register(conversationRoutes);
  await app.register(messageRoutes);
  await app.register(messageDraftRoutes);
  await app.register(telegramRoutes);
  await app.register(pipelineRoutes);
  await app.register(dealRoutes);
  await app.register(quickReplyTemplateRoutes);
  await app.register(taskRoutes);
  await app.register(activityLogRoutes);
  await app.register(notificationRoutes);
  await app.register(telegramNotificationRoutes);
  await app.register(telegramMessageTemplateRoutes);
  await app.register(webFormRoutes);
  await app.register(mediaRoutes);
  await app.register(chatbotFlowRoutes);
  await app.register(automationRuleRoutes);
  await app.register(widgetRoutes);
  await app.register(reportRoutes);
  await app.register(publicApiRoutes);
  await app.register(apiKeyRoutes);
  await app.register(webhookRoutes);
  await app.register(webPushRoutes);
  await app.register(emailRoutes);
  await app.register(webChatRoutes);
  await app.register(whatsappRoutes);
  await app.register(instagramRoutes);
  await app.register(novofonRoutes);
  await app.register(voximplantRoutes);
  await app.register(telephonyRoutes);
  await app.register(knowledgeBaseRoutes);
  await app.register(quizRoutes);
  await app.register(batchRoutes);
  await app.register(kommoRoutes);

  return app;
}
