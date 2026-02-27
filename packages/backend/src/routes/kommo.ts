import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  connectKommoAccount,
  getKommoAccount,
  disconnectKommoAccount,
  listKommoContacts,
  listKommoContactNotes,
  listKommoTalks,
  getKommoTalkMessages,
} from '../services/kommo.js';

const connectBody = z.object({
  subdomain: z.string().min(1, 'Subdomain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
});

export async function kommoRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Connect Kommo account
  typedApp.post(
    '/api/kommo/connect',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: { tags: ['Kommo'], summary: 'Connect Kommo account', body: connectBody },
    },
    async (request, reply) => {
      try {
        const account = await connectKommoAccount(
          request.body.subdomain,
          request.body.accessToken,
          {
            userId: request.user.sub,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          },
        );
        return reply.status(201).send(account);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to connect amoCRM account';
        return reply.badRequest(message);
      }
    },
  );

  // Get connected account
  typedApp.get(
    '/api/kommo/account',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: { tags: ['Kommo'], summary: 'Get connected Kommo account' },
    },
    async (_request, reply) => {
      const account = getKommoAccount();
      if (!account) {
        return reply.notFound('No amoCRM account connected');
      }
      return reply.send(account);
    },
  );

  // Disconnect Kommo account
  typedApp.delete(
    '/api/kommo/disconnect',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: { tags: ['Kommo'], summary: 'Disconnect Kommo account' },
    },
    async (request, reply) => {
      const deleted = await disconnectKommoAccount({
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('No amoCRM account connected');
      }

      return reply.status(204).send();
    },
  );

  // List Kommo contacts
  typedApp.get(
    '/api/kommo/contacts',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Kommo'],
        summary: 'List Kommo contacts',
        querystring: z.object({ query: z.string().optional() }),
      },
    },
    async (request, reply) => {
      try {
        const contacts = await listKommoContacts(request.query.query);
        return reply.send({ entries: contacts });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch contacts';
        return reply.badRequest(message);
      }
    },
  );

  // Get contact notes
  typedApp.get(
    '/api/kommo/contacts/:id/notes',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Kommo'],
        summary: 'Get contact notes',
        params: z.object({ id: z.coerce.number().int().positive() }),
      },
    },
    async (request, reply) => {
      try {
        const notes = await listKommoContactNotes(request.params.id);
        return reply.send({ entries: notes });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch contact notes';
        return reply.badRequest(message);
      }
    },
  );

  // List Kommo talks
  typedApp.get(
    '/api/kommo/talks',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: { tags: ['Kommo'], summary: 'List Kommo talks' },
    },
    async (_request, reply) => {
      try {
        const talks = await listKommoTalks();
        return reply.send({ entries: talks });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch talks';
        return reply.badRequest(message);
      }
    },
  );

  // Get talk messages
  typedApp.get(
    '/api/kommo/talks/:id/messages',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Kommo'],
        summary: 'Get talk messages',
        params: z.object({ id: z.coerce.number().int().positive() }),
      },
    },
    async (request, reply) => {
      try {
        const messages = await getKommoTalkMessages(request.params.id);
        return reply.send({ entries: messages });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch talk messages';
        return reply.badRequest(message);
      }
    },
  );
}
