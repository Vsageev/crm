import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { queryAuditLogs, type AuditLogQuery } from '../services/audit-log.js';

export async function auditLogRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/api/audit-logs',
    {
      schema: {
        tags: ['Audit Logs'],
        summary: 'Query audit logs',
        querystring: z.object({
          userId: z.string().optional(),
          entityType: z.string().optional(),
          entityId: z.string().optional(),
          action: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (req, reply) => {
      try {
        const query: AuditLogQuery = {
          userId: req.query.userId,
          entityType: req.query.entityType,
          entityId: req.query.entityId,
          action: req.query.action as AuditLogQuery['action'],
          from: req.query.from ? new Date(req.query.from) : undefined,
          to: req.query.to ? new Date(req.query.to) : undefined,
          limit: req.query.limit,
          offset: req.query.offset,
        };

        const { entries, total } = await queryAuditLogs(query);

        return reply.send({
          total,
          limit: query.limit ?? 50,
          offset: query.offset ?? 0,
          entries,
        });
      } catch (err) {
        app.log.error(err, 'Failed to query audit logs');
        return reply.status(500).send({ message: 'Failed to query audit logs' });
      }
    },
  );
}
