import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  connectBot,
  disconnectBot,
  listBots,
  getBotById,
  refreshWebhook,
  updateAutoGreeting,
} from '../services/telegram.js';
import { handleTelegramWebhook } from '../services/telegram-webhook.js';

const connectBotBody = z.object({
  token: z.string().min(1, 'Bot token is required'),
});

const autoGreetingBody = z.object({
  enabled: z.boolean(),
  text: z.string().max(4096).nullable().optional(),
});

export async function telegramRoutes(app: FastifyInstance) {
  // List connected bots
  app.get(
    '/api/telegram/bots',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (_request, reply) => {
      const bots = await listBots();
      return reply.send({ entries: bots });
    },
  );

  // Get single bot
  app.get<{ Params: { id: string } }>(
    '/api/telegram/bots/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (request, reply) => {
      const bot = await getBotById(request.params.id);
      if (!bot) {
        return reply.notFound('Telegram bot not found');
      }
      return reply.send(bot);
    },
  );

  // Connect a new bot
  app.post(
    '/api/telegram/bots',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = connectBotBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      try {
        const bot = await connectBot(parsed.data.token, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
        return reply.status(201).send(bot);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to connect bot';
        return reply.badRequest(message);
      }
    },
  );

  // Disconnect (delete) a bot
  app.delete<{ Params: { id: string } }>(
    '/api/telegram/bots/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const deleted = await disconnectBot(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Telegram bot not found');
      }

      return reply.status(204).send();
    },
  );

  // Refresh webhook for a bot
  app.post<{ Params: { id: string } }>(
    '/api/telegram/bots/:id/refresh-webhook',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      try {
        const bot = await refreshWebhook(request.params.id, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        if (!bot) {
          return reply.notFound('Telegram bot not found');
        }

        return reply.send(bot);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to refresh webhook';
        return reply.badRequest(message);
      }
    },
  );

  // Update auto-greeting settings for a bot
  app.patch<{ Params: { id: string } }>(
    '/api/telegram/bots/:id/auto-greeting',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = autoGreetingBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const bot = await updateAutoGreeting(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!bot) {
        return reply.notFound('Telegram bot not found');
      }

      return reply.send(bot);
    },
  );

  // Telegram webhook endpoint — receives inbound updates from Telegram
  // No auth middleware: verified by webhook secret header instead
  app.post<{ Params: { botId: string } }>(
    '/api/telegram/webhook/:botId',
    async (request, reply) => {
      const { botId } = request.params;
      const secretHeader = request.headers['x-telegram-bot-api-secret-token'] as string | undefined;

      try {
        const result = await handleTelegramWebhook(
          botId,
          secretHeader,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          request.body as any,
        );

        if (!result.ok && result.error === 'Invalid webhook secret') {
          return reply.forbidden('Invalid webhook secret');
        }

        if (!result.ok && result.error === 'Bot not found') {
          return reply.notFound('Bot not found');
        }

        // Always return 200 to Telegram to prevent retries
        return reply.send({ ok: true });
      } catch (err) {
        // Log the error but still return 200 to Telegram
        request.log.error(err, 'Telegram webhook processing error');
        return reply.send({ ok: true });
      }
    },
  );
}
