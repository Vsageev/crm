import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  connectWhatsAppAccount,
  disconnectWhatsAppAccount,
  listWhatsAppAccounts,
  getWhatsAppAccountById,
  testWhatsAppAccount,
  updateAutoGreeting,
} from '../services/whatsapp.js';
import { handleWhatsAppWebhook, type WhatsAppWebhookPayload } from '../services/whatsapp-webhook.js';

const connectAccountBody = z.object({
  phoneNumberId: z.string().min(1, 'Phone Number ID is required'),
  businessAccountId: z.string().min(1, 'Business Account ID is required'),
  accessToken: z.string().min(1, 'Access Token is required'),
  accountName: z.string().min(1, 'Account name is required'),
});

const autoGreetingBody = z.object({
  enabled: z.boolean(),
  text: z.string().max(4096).nullable().optional(),
});

export async function whatsappRoutes(app: FastifyInstance) {
  // List connected accounts
  app.get(
    '/api/whatsapp/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (_request, reply) => {
      const accounts = await listWhatsAppAccounts();
      return reply.send({ entries: accounts });
    },
  );

  // Get single account
  app.get<{ Params: { id: string } }>(
    '/api/whatsapp/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (request, reply) => {
      const account = await getWhatsAppAccountById(request.params.id);
      if (!account) {
        return reply.notFound('WhatsApp account not found');
      }
      return reply.send(account);
    },
  );

  // Connect a new account
  app.post(
    '/api/whatsapp/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = connectAccountBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      try {
        const account = await connectWhatsAppAccount(parsed.data, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
        return reply.status(201).send(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to connect account';
        return reply.badRequest(message);
      }
    },
  );

  // Disconnect (delete) an account
  app.delete<{ Params: { id: string } }>(
    '/api/whatsapp/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const deleted = await disconnectWhatsAppAccount(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('WhatsApp account not found');
      }

      return reply.status(204).send();
    },
  );

  // Test connection for an account
  app.post<{ Params: { id: string } }>(
    '/api/whatsapp/accounts/:id/test',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      try {
        const account = await testWhatsAppAccount(request.params.id, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        if (!account) {
          return reply.notFound('WhatsApp account not found');
        }

        return reply.send(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to test account';
        return reply.badRequest(message);
      }
    },
  );

  // Update auto-greeting settings
  app.patch<{ Params: { id: string } }>(
    '/api/whatsapp/accounts/:id/auto-greeting',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = autoGreetingBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const account = await updateAutoGreeting(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!account) {
        return reply.notFound('WhatsApp account not found');
      }

      return reply.send(account);
    },
  );

  // WhatsApp webhook verification (GET) — Meta sends a verification challenge
  app.get<{
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>(
    '/api/whatsapp/webhook',
    async (request, reply) => {
      const mode = request.query['hub.mode'];
      const token = request.query['hub.verify_token'];
      const challenge = request.query['hub.challenge'];

      if (mode !== 'subscribe' || !token || !challenge) {
        return reply.status(403).send('Forbidden');
      }

      // We need the raw verify token — query all accounts from DB
      const { store } = await import('../db/index.js');
      const allAccounts = store.find('whatsappAccounts', () => true);
      const matched = allAccounts.find((a: Record<string, unknown>) => a.webhookVerifyToken === token);

      if (!matched) {
        return reply.status(403).send('Invalid verify token');
      }

      // Return the challenge to complete verification
      return reply.status(200).send(challenge);
    },
  );

  // WhatsApp webhook endpoint (POST) — receives inbound notifications from Meta
  // No auth middleware: verified by webhook signature
  app.post(
    '/api/whatsapp/webhook',
    async (request, reply) => {
      try {
        await handleWhatsAppWebhook(
          request.body as WhatsAppWebhookPayload,
        );

        // Always return 200 to Meta to prevent retries
        return reply.send({ ok: true });
      } catch (err) {
        request.log.error(err, 'WhatsApp webhook processing error');
        return reply.send({ ok: true });
      }
    },
  );
}
