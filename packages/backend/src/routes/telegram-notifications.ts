import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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

const linkBody = z.object({
  linkToken: z.string().min(1),
  chatId: z.string().min(1),
  username: z.string().optional(),
});

export async function telegramNotificationRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Get current user's Telegram notification settings
  typedApp.get(
    '/api/telegram-notifications/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Telegram Notifications'],
        summary: 'Get Telegram notification settings',
      },
    },
    async (request, reply) => {
      const settings = await getSettingsByUserId(request.user.sub);
      return reply.send({ settings });
    },
  );

  // Update notification preferences
  typedApp.patch(
    '/api/telegram-notifications/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Telegram Notifications'],
        summary: 'Update notification preferences',
        body: updateSettingsBody,
      },
    },
    async (request, reply) => {
      const updated = await updateSettings(request.user.sub, request.body);
      if (!updated) {
        return reply.notFound(
          'Telegram notifications not set up. Generate a link token first and connect via the bot.',
        );
      }

      return reply.send({ settings: updated });
    },
  );

  // Generate a link token to pair Telegram chat with CRM account
  typedApp.post(
    '/api/telegram-notifications/link-token',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Telegram Notifications'],
        summary: 'Generate a link token for Telegram pairing',
      },
    },
    async (request, reply) => {
      const token = await generateLinkToken(request.user.sub);
      return reply.send({ linkToken: token });
    },
  );

  // Unlink Telegram notifications
  typedApp.delete(
    '/api/telegram-notifications/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Telegram Notifications'],
        summary: 'Unlink Telegram notifications',
      },
    },
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
  typedApp.post(
    '/api/telegram-notifications/link',
    {
      schema: {
        tags: ['Telegram Notifications'],
        summary: 'Link Telegram chat via bot webhook',
        body: linkBody,
      },
    },
    async (request, reply) => {
      const result = await linkTelegramChat(request.body.linkToken, request.body.chatId, request.body.username);
      if (!result) {
        return reply.badRequest('Invalid or expired link token');
      }

      return reply.send({ ok: true });
    },
  );
}
