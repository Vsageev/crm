import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { store } from '../db/index.js';
import {
  connectAccount,
  disconnectAccount,
  listAccounts,
  getAccountById,
  getRawAccountById,
  getLoginCredentials,
  initiateCallback,
} from '../services/voximplant.js';
import { handleVoximplantWebhook } from '../services/voximplant-webhook.js';

const connectAccountBody = z.object({
  accountId: z.string().min(1, 'Account ID is required'),
  keyId: z.string().min(1, 'Key ID is required'),
  privateKey: z.string().min(1, 'Private Key is required'),
  callbackRuleId: z.number().int().positive().optional(),
  agentPhoneNumber: z.string().trim().min(1).optional(),
  callerId: z.string().trim().min(1).optional(),
});

const callBody = z.object({
  phoneNumber: z.string().min(1, 'phoneNumber is required'),
});

export async function voximplantRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List connected accounts
  typedApp.get(
    '/api/voximplant/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Voximplant'], summary: 'List connected accounts' } },
    async (_request, reply) => {
      const accounts = listAccounts();
      return reply.send({ entries: accounts });
    },
  );

  // Get single account
  typedApp.get(
    '/api/voximplant/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Voximplant'], summary: 'Get single account', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const account = getAccountById(request.params.id);
      if (!account) {
        return reply.notFound('Voximplant account not found');
      }
      return reply.send(account);
    },
  );

  // Connect a new account
  typedApp.post(
    '/api/voximplant/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Voximplant'], summary: 'Connect a new account', body: connectAccountBody } },
    async (request, reply) => {
      try {
        const account = await connectAccount(
          request.body.accountId,
          request.body.keyId,
          request.body.privateKey,
          request.body.callbackRuleId,
          request.body.agentPhoneNumber,
          request.body.callerId,
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
    '/api/voximplant/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Voximplant'], summary: 'Disconnect an account', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const deleted = await disconnectAccount(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Voximplant account not found');
      }

      return reply.status(204).send();
    },
  );

  // Initiate outbound callback call
  typedApp.post(
    '/api/voximplant/accounts/:id/call',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Voximplant'], summary: 'Initiate outbound call', params: z.object({ id: z.uuid() }), body: callBody } },
    async (request, reply) => {
      const account = getRawAccountById(request.params.id);
      if (!account) {
        return reply.notFound('Voximplant account not found');
      }

      const phoneNumber = request.body.phoneNumber.trim();
      if (!phoneNumber) {
        return reply.badRequest('phoneNumber is required');
      }

      const callbackRuleIdRaw = account.callbackRuleId;
      const callbackRuleId =
        typeof callbackRuleIdRaw === 'number'
          ? callbackRuleIdRaw
          : Number.isFinite(Number(callbackRuleIdRaw))
            ? Number(callbackRuleIdRaw)
            : null;

      try {
        const result = await initiateCallback(
          account.accountId as string,
          account.keyId as string,
          account.privateKey as string,
          phoneNumber,
          callbackRuleId,
          typeof account.agentPhoneNumber === 'string' ? account.agentPhoneNumber : null,
          typeof account.callerId === 'string' ? account.callerId : null,
        );

        if (typeof account.id === 'string') {
          const currentCallerId = typeof account.callerId === 'string' ? account.callerId.trim() : '';
          if (!currentCallerId || currentCallerId !== result.callerId) {
            store.update('voximplantAccounts', account.id, { callerId: result.callerId });
          }
        }

        return reply.send({
          callSessionHistoryId: result.callSessionHistoryId || null,
          ruleId: result.ruleId,
          callerId: result.callerId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initiate call';
        return reply.badRequest(message);
      }
    },
  );

  // Get login credentials for Web SDK
  typedApp.get(
    '/api/voximplant/accounts/:id/login-credentials',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Voximplant'], summary: 'Get login credentials for Web SDK', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const account = getRawAccountById(request.params.id);
      if (!account) {
        return reply.notFound('Voximplant account not found');
      }
      try {
        const credentials = await getLoginCredentials(
          account.accountId as string,
          account.keyId as string,
          account.privateKey as string,
          typeof account.callerId === 'string' ? account.callerId : null,
        );

        if (typeof account.id === 'string') {
          const currentCallerId = typeof account.callerId === 'string' ? account.callerId.trim() : '';
          if (!currentCallerId || currentCallerId !== credentials.callerId) {
            store.update('voximplantAccounts', account.id, { callerId: credentials.callerId });
          }
        }

        return reply.send({
          ...credentials,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to get login credentials';
        return reply.badRequest(message);
      }
    },
  );

  // Webhook endpoint — receives call events from Voximplant
  // No auth middleware: Voximplant sends events here directly
  typedApp.post(
    '/api/voximplant/webhook',
    { schema: { tags: ['Voximplant'], summary: 'Voximplant webhook endpoint' } },
    async (request, reply) => {
      try {
        const result = await handleVoximplantWebhook(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          request.body as any,
        );
        return reply.send(result);
      } catch (err) {
        request.log.error(err, 'Voximplant webhook processing error');
        return reply.send({ ok: true });
      }
    },
  );
}
