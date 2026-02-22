import type { FastifyInstance } from 'fastify';
import { queryAuditLogs, type AuditLogQuery } from '../services/audit-log.js';

export async function auditLogRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      userId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/audit-logs', async (req, reply) => {
    try {
      const query: AuditLogQuery = {
        userId: req.query.userId,
        entityType: req.query.entityType,
        entityId: req.query.entityId,
        action: req.query.action as AuditLogQuery['action'],
        from: req.query.from ? new Date(req.query.from) : undefined,
        to: req.query.to ? new Date(req.query.to) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
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
  });
}
