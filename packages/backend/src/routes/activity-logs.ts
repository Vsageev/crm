import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List activity logs
  typedApp.get(
    '/api/activity-logs',
    {
      onRequest: [app.authenticate, requirePermission('activities:read')],
      schema: {
        tags: ['Activity Logs'],
        summary: 'List activity logs',
        querystring: z.object({
          contactId: z.string().optional(),
          dealId: z.string().optional(),
          type: z.string().optional(),
          createdById: z.string().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listActivityLogs({
        contactId: request.query.contactId,
        dealId: request.query.dealId,
        type: request.query.type,
        createdById: request.query.createdById,
        search: request.query.search,
        limit: request.query.limit,
        offset: request.query.offset,
      });

      return reply.send({
        total,
        limit: request.query.limit ?? 50,
        offset: request.query.offset ?? 0,
        entries,
      });
    },
  );

  // Get single activity log
  typedApp.get(
    '/api/activity-logs/:id',
    {
      onRequest: [app.authenticate, requirePermission('activities:read')],
      schema: {
        tags: ['Activity Logs'],
        summary: 'Get a single activity log by ID',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const entry = await getActivityLogById(request.params.id);
      if (!entry) {
        return reply.notFound('Activity log not found');
      }
      return reply.send(entry);
    },
  );

  // Create activity log
  typedApp.post(
    '/api/activity-logs',
    {
      onRequest: [app.authenticate, requirePermission('activities:create')],
      schema: {
        tags: ['Activity Logs'],
        summary: 'Create a new activity log',
        body: createActivityLogBody,
      },
    },
    async (request, reply) => {
      const entry = await createActivityLog(request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(entry);
    },
  );

  // Update activity log
  typedApp.patch(
    '/api/activity-logs/:id',
    {
      onRequest: [app.authenticate, requirePermission('activities:update')],
      schema: {
        tags: ['Activity Logs'],
        summary: 'Update an existing activity log',
        params: z.object({ id: z.uuid() }),
        body: updateActivityLogBody,
      },
    },
    async (request, reply) => {
      const updated = await updateActivityLog(request.params.id, request.body, {
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
  typedApp.delete(
    '/api/activity-logs/:id',
    {
      onRequest: [app.authenticate, requirePermission('activities:delete')],
      schema: {
        tags: ['Activity Logs'],
        summary: 'Delete an activity log',
        params: z.object({ id: z.uuid() }),
      },
    },
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
