import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  connectAccount,
  disconnectAccount,
  listAccounts,
  getAccountById,
  getRawAccountById,
  getWebRtcKey,
  initiateCallback,
} from '../services/novofon.js';
import { handleNovofonWebhook } from '../services/novofon-webhook.js';

const connectAccountBody = z.object({
  apiKey: z.string().min(1, 'API Key is required'),
  apiSecret: z.string().min(1, 'API Secret is required'),
  sipLogin: z.string().min(1, 'SIP Login is required'),
});

const callBody = z.object({ phoneNumber: z.string().min(1) });

export async function novofonRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List connected accounts
  typedApp.get(
    '/api/novofon/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Novofon'], summary: 'List connected accounts' } },
    async (_request, reply) => {
      const accounts = listAccounts();
      return reply.send({ entries: accounts });
    },
  );

  // Get single account
  typedApp.get(
    '/api/novofon/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Novofon'], summary: 'Get single account', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const account = getAccountById(request.params.id);
      if (!account) {
        return reply.notFound('Novofon account not found');
      }
      return reply.send(account);
    },
  );

  // Connect a new account
  typedApp.post(
    '/api/novofon/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Novofon'], summary: 'Connect a new account', body: connectAccountBody } },
    async (request, reply) => {
      try {
        const account = await connectAccount(
          request.body.apiKey,
          request.body.apiSecret,
          request.body.sipLogin,
          {
            userId: request.user.sub,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          },
        );
        return reply.status(201).send(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to connect account';
        return reply.badRequest(message);
      }
    },
  );

  // Disconnect (delete) an account
  typedApp.delete(
    '/api/novofon/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Novofon'], summary: 'Disconnect an account', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const deleted = await disconnectAccount(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Novofon account not found');
      }

      return reply.status(204).send();
    },
  );

  // Get WebRTC key for browser calling
  typedApp.get(
    '/api/novofon/accounts/:id/webrtc-key',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Novofon'], summary: 'Get WebRTC key', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const account = getRawAccountById(request.params.id);
      if (!account) {
        return reply.notFound('Novofon account not found');
      }
      try {
        const key = await getWebRtcKey(
          account.apiKey as string,
          account.apiSecret as string,
        );
        return reply.send({ key });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to get WebRTC key';
        return reply.badRequest(message);
      }
    },
  );

  // Initiate outbound call
  typedApp.post(
    '/api/novofon/accounts/:id/call',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Novofon'], summary: 'Initiate outbound call', params: z.object({ id: z.uuid() }), body: callBody } },
    async (request, reply) => {
      const account = getRawAccountById(request.params.id);
      if (!account) {
        return reply.notFound('Novofon account not found');
      }
      try {
        const callId = await initiateCallback(
          account.apiKey as string,
          account.apiSecret as string,
          account.sipLogin as string,
          request.body.phoneNumber,
        );
        return reply.send({ callId });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initiate call';
        return reply.badRequest(message);
      }
    },
  );

  // Webhook endpoint — receives call events from Novofon
  // No auth middleware: Novofon sends events here directly
  typedApp.post(
    '/api/novofon/webhook',
    { schema: { tags: ['Novofon'], summary: 'Novofon webhook endpoint' } },
    async (request, reply) => {
      try {
        const result = await handleNovofonWebhook(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          request.body as any,
        );
        return reply.send(result);
      } catch (err) {
        request.log.error(err, 'Novofon webhook processing error');
        return reply.send({ ok: true });
      }
    },
  );
}
