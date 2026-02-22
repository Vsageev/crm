import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import {
  getSettingsByUserId,
  updateSettings,
  generateLinkToken,
  unlinkTelegram,
  linkTelegramChat,
} from '../services/telegram-notifications.js';

const updateSettingsBody = z.object({
  enabled: z.boolean().optional(),
  notifyNewLead: z.boolean().optional(),
  notifyTaskDueSoon: z.boolean().optional(),
  notifyTaskOverdue: z.boolean().optional(),
  notifyDealStageChange: z.boolean().optional(),
  notifyLeadAssigned: z.boolean().optional(),
});

export async function telegramNotificationRoutes(app: FastifyInstance) {
  // Get current user's Telegram notification settings
  app.get(
    '/api/telegram-notifications/settings',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const settings = await getSettingsByUserId(request.user.sub);
      return reply.send({ settings });
    },
  );

  // Update notification preferences
  app.patch(
    '/api/telegram-notifications/settings',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const parsed = updateSettingsBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const updated = await updateSettings(request.user.sub, parsed.data);
      if (!updated) {
        return reply.notFound(
          'Telegram notifications not set up. Generate a link token first and connect via the bot.',
        );
      }

      return reply.send({ settings: updated });
    },
  );

  // Generate a link token to pair Telegram chat with CRM account
  app.post(
    '/api/telegram-notifications/link-token',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const token = await generateLinkToken(request.user.sub);
      return reply.send({ linkToken: token });
    },
  );

  // Unlink Telegram notifications
  app.delete(
    '/api/telegram-notifications/settings',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const deleted = await unlinkTelegram(request.user.sub);
      if (!deleted) {
        return reply.notFound('No Telegram notification settings found');
      }
      return reply.status(204).send();
    },
  );

  // Webhook callback for bot /start linking
  // This endpoint is called by the Telegram webhook handler when a user
  // sends /start <token> to the bot. It's unauthenticated — verified by token.
  app.post(
    '/api/telegram-notifications/link',
    async (request, reply) => {
      const body = request.body as { linkToken?: string; chatId?: string; username?: string };

      if (!body.linkToken || !body.chatId) {
        return reply.badRequest('linkToken and chatId are required');
      }

      const result = await linkTelegramChat(body.linkToken, body.chatId, body.username);
      if (!result) {
        return reply.badRequest('Invalid or expired link token');
      }

      return reply.send({ ok: true });
    },
  );
}
