import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  connectEmailAccount,
  disconnectEmailAccount,
  listEmailAccounts,
  getEmailAccountById,
  testEmailAccount,
} from '../services/email.js';
import { syncEmailAccount } from '../services/email-inbound.js';

const connectEmailBody = z.object({
  email: z.email(),
  name: z.string().max(255).optional(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().positive().optional(),
  imapSecure: z.boolean().optional(),
  imapUsername: z.string().min(1),
  imapPassword: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().positive().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.string().min(1),
  smtpPassword: z.string().min(1),
});

export async function emailRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List connected email accounts
  typedApp.get(
    '/api/email/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Email'], summary: 'List connected email accounts' } },
    async (_request, reply) => {
      const accounts = await listEmailAccounts();
      return reply.send({ entries: accounts });
    },
  );

  // Get single email account
  typedApp.get(
    '/api/email/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Email'], summary: 'Get single email account', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const account = await getEmailAccountById(request.params.id);
      if (!account) {
        return reply.notFound('Email account not found');
      }
      return reply.send(account);
    },
  );

  // Connect a new email account
  typedApp.post(
    '/api/email/accounts',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Email'], summary: 'Connect a new email account', body: connectEmailBody } },
    async (request, reply) => {
      try {
        const account = await connectEmailAccount(request.body, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
        return reply.status(201).send(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to connect email account';
        return reply.badRequest(message);
      }
    },
  );

  // Disconnect (delete) an email account
  typedApp.delete(
    '/api/email/accounts/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Email'], summary: 'Disconnect an email account', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const deleted = await disconnectEmailAccount(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Email account not found');
      }

      return reply.status(204).send();
    },
  );

  // Test connection for an email account
  typedApp.post(
    '/api/email/accounts/:id/test',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Email'], summary: 'Test email account connection', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      try {
        const account = await testEmailAccount(request.params.id, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        if (!account) {
          return reply.notFound('Email account not found');
        }

        return reply.send(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection test failed';
        return reply.badRequest(message);
      }
    },
  );

  // Trigger manual sync for an email account
  typedApp.post(
    '/api/email/accounts/:id/sync',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Email'], summary: 'Trigger manual email sync', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      try {
        const result = await syncEmailAccount(request.params.id);
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        return reply.badRequest(message);
      }
    },
  );
}
