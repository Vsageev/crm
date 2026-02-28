import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listConnectors,
  getConnectorById,
  createConnector,
  deleteConnector,
  refreshConnector,
  updateConnectorSettings,
} from '../services/connectors.js';

const createBody = z.object({
  type: z.enum(['telegram']),
}).catchall(z.unknown());

const settingsBody = z.record(z.string(), z.unknown()).refine(
  (v) => Object.keys(v).length > 0,
  'At least one setting is required',
);

export async function connectorRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/api/connectors',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: { tags: ['Connectors'], summary: 'List all connectors' },
    },
    async (_request, reply) => {
      return reply.send({ entries: await listConnectors() });
    },
  );

  typedApp.get(
    '/api/connectors/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Connectors'],
        summary: 'Get a single connector',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const connector = await getConnectorById(request.params.id);
      if (!connector) return reply.notFound('Connector not found');
      return reply.send(connector);
    },
  );

  typedApp.post(
    '/api/connectors',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Connectors'],
        summary: 'Create a new connector',
        body: createBody,
      },
    },
    async (request, reply) => {
      try {
        const { type, ...rest } = request.body;
        const connector = await createConnector(type, rest, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
        return reply.status(201).send(connector);
      } catch (err) {
        return reply.badRequest(err instanceof Error ? err.message : 'Failed to create connector');
      }
    },
  );

  typedApp.delete(
    '/api/connectors/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Connectors'],
        summary: 'Delete a connector',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const deleted = await deleteConnector(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      if (!deleted) return reply.notFound('Connector not found');
      return reply.status(204).send();
    },
  );

  typedApp.post(
    '/api/connectors/:id/refresh',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Connectors'],
        summary: 'Refresh connector connection',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      try {
        const connector = await refreshConnector(request.params.id, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
        if (!connector) return reply.notFound('Connector not found');
        return reply.send(connector);
      } catch (err) {
        return reply.badRequest(err instanceof Error ? err.message : 'Failed to refresh connector');
      }
    },
  );

  typedApp.patch(
    '/api/connectors/:id/settings',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Connectors'],
        summary: 'Update connector settings',
        params: z.object({ id: z.uuid() }),
        body: settingsBody,
      },
    },
    async (request, reply) => {
      const connector = await updateConnectorSettings(
        request.params.id,
        request.body as Record<string, unknown>,
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );
      if (!connector) return reply.notFound('Connector not found');
      return reply.send(connector);
    },
  );
}
