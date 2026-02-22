import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requireRole } from '../middleware/rbac.js';
import {
  createApiKey,
  listApiKeys,
  getApiKeyById,
  updateApiKey,
  deleteApiKey,
} from '../services/api-keys.js';

const createApiKeyBody = z.object({
  name: z.string().min(1).max(255),
  permissions: z.array(z.string().min(1)).min(1),
  description: z.string().max(1000).optional(),
  expiresAt: z.iso.datetime().optional(),
});

const updateApiKeyBody = z.object({
  name: z.string().min(1).max(255).optional(),
  permissions: z.array(z.string().min(1)).min(1).optional(),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
});

function auditMeta(request: { user: { sub: string }; ip: string; headers: Record<string, string | string[] | undefined> }) {
  return {
    userId: request.user.sub,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] as string | undefined,
  };
}

export async function apiKeyRoutes(app: FastifyInstance) {
  // List API keys — admins see all, managers see their own
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>(
    '/api/api-keys',
    { onRequest: [app.authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const limit = request.query.limit ? Math.min(Math.max(parseInt(request.query.limit, 10) || 50, 1), 100) : 50;
      const offset = request.query.offset ? Math.max(parseInt(request.query.offset, 10) || 0, 0) : 0;

      const user = request.user as { sub: string; role: string };
      const createdById = user.role === 'admin' ? undefined : user.sub;

      const { entries, total } = await listApiKeys({ createdById, limit, offset });
      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single API key
  app.get<{ Params: { id: string } }>(
    '/api/api-keys/:id',
    { onRequest: [app.authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const key = await getApiKeyById(request.params.id) as any;
      if (!key) return reply.notFound('API key not found');

      const user = request.user as { sub: string; role: string };
      if (user.role !== 'admin' && key.createdById !== user.sub) {
        return reply.forbidden('Access denied');
      }

      return reply.send(key);
    },
  );

  // Create API key — returns the raw key only once
  app.post(
    '/api/api-keys',
    { onRequest: [app.authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const parsed = createApiKeyBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const result = await createApiKey(
        {
          name: parsed.data.name,
          permissions: parsed.data.permissions,
          createdById: request.user.sub,
          description: parsed.data.description,
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
        },
        auditMeta(request),
      ) as any;

      return reply.status(201).send({
        id: result.id,
        name: result.name,
        keyPrefix: result.keyPrefix,
        permissions: result.permissions,
        description: result.description,
        isActive: result.isActive,
        expiresAt: result.expiresAt,
        createdAt: result.createdAt,
        // The raw key — shown only once
        key: result.rawKey,
      });
    },
  );

  // Update API key
  app.patch<{ Params: { id: string } }>(
    '/api/api-keys/:id',
    { onRequest: [app.authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const parsed = updateApiKeyBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const existing = await getApiKeyById(request.params.id) as any;
      if (!existing) return reply.notFound('API key not found');

      const user = request.user as { sub: string; role: string };
      if (user.role !== 'admin' && existing.createdById !== user.sub) {
        return reply.forbidden('Access denied');
      }

      const data: Record<string, unknown> = { ...parsed.data };
      if (parsed.data.expiresAt !== undefined) {
        data.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
      }

      const updated = await updateApiKey(request.params.id, data, auditMeta(request));
      if (!updated) return reply.notFound('API key not found');

      return reply.send(updated);
    },
  );

  // Delete (revoke) API key
  app.delete<{ Params: { id: string } }>(
    '/api/api-keys/:id',
    { onRequest: [app.authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const existing = await getApiKeyById(request.params.id) as any;
      if (!existing) return reply.notFound('API key not found');

      const user = request.user as { sub: string; role: string };
      if (user.role !== 'admin' && existing.createdById !== user.sub) {
        return reply.forbidden('Access denied');
      }

      await deleteApiKey(request.params.id, auditMeta(request));
      return reply.status(204).send();
    },
  );
}
