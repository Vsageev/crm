import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listActivityLogs,
  getActivityLogById,
  createActivityLog,
  updateActivityLog,
  deleteActivityLog,
} from '../services/activity-logs.js';

const activityTypes = ['call', 'meeting', 'note'] as const;

const createActivityLogBody = z.object({
  type: z.enum(activityTypes),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  duration: z.int().min(0).optional(),
  occurredAt: z.iso.datetime().optional(),
  meta: z.record(z.string(), z.string()).optional(),
});

const updateActivityLogBody = z.object({
  type: z.enum(activityTypes).optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  duration: z.int().min(0).nullable().optional(),
  occurredAt: z.iso.datetime().optional(),
  meta: z.record(z.string(), z.string()).nullable().optional(),
});

export async function activityLogRoutes(app: FastifyInstance) {
  // List activity logs
  app.get<{
    Querystring: {
      contactId?: string;
      dealId?: string;
      type?: string;
      createdById?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/activity-logs',
    { onRequest: [app.authenticate, requirePermission('activities:read')] },
    async (request, reply) => {
      const { entries, total } = await listActivityLogs({
        contactId: request.query.contactId,
        dealId: request.query.dealId,
        type: request.query.type,
        createdById: request.query.createdById,
        search: request.query.search,
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
      });

      return reply.send({
        total,
        limit: request.query.limit ? parseInt(request.query.limit, 10) : 50,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : 0,
        entries,
      });
    },
  );

  // Get single activity log
  app.get<{ Params: { id: string } }>(
    '/api/activity-logs/:id',
    { onRequest: [app.authenticate, requirePermission('activities:read')] },
    async (request, reply) => {
      const entry = await getActivityLogById(request.params.id);
      if (!entry) {
        return reply.notFound('Activity log not found');
      }
      return reply.send(entry);
    },
  );

  // Create activity log
  app.post(
    '/api/activity-logs',
    { onRequest: [app.authenticate, requirePermission('activities:create')] },
    async (request, reply) => {
      const parsed = createActivityLogBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const entry = await createActivityLog(parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(entry);
    },
  );

  // Update activity log
  app.patch<{ Params: { id: string } }>(
    '/api/activity-logs/:id',
    { onRequest: [app.authenticate, requirePermission('activities:update')] },
    async (request, reply) => {
      const parsed = updateActivityLogBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const updated = await updateActivityLog(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Activity log not found');
      }

      return reply.send(updated);
    },
  );

  // Delete activity log
  app.delete<{ Params: { id: string } }>(
    '/api/activity-logs/:id',
    { onRequest: [app.authenticate, requirePermission('activities:delete')] },
    async (request, reply) => {
      const deleted = await deleteActivityLog(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Activity log not found');
      }

      return reply.status(204).send();
    },
  );
}
