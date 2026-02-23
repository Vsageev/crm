import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission, isAgent } from '../middleware/rbac.js';
import {
  getPipelineSummary,
  getAllPipelinesSummary,
  getAgentPerformance,
  getLeadSourceBreakdown,
  exportPipelineSummaryCsv,
  exportAgentPerformanceCsv,
  exportLeadSourceCsv,
} from '../services/reports.js';
import { createAuditLog } from '../services/audit-log.js';

export async function reportRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Get summary for all pipelines
  typedApp.get(
    '/api/reports/pipelines',
    {
      onRequest: [app.authenticate, requirePermission('reports:read')],
      schema: {
        tags: ['Reports'],
        summary: 'Get summary for all pipelines',
        querystring: z.object({
          ownerId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      // Agents only see their own data
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;
      const data = await getAllPipelinesSummary(ownerId);
      return reply.send({ entries: data });
    },
  );

  // Get detailed summary for a single pipeline
  typedApp.get(
    '/api/reports/pipelines/:id',
    {
      onRequest: [app.authenticate, requirePermission('reports:read')],
      schema: {
        tags: ['Reports'],
        summary: 'Get detailed summary for a single pipeline',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({
          ownerId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;
      const data = await getPipelineSummary({
        pipelineId: request.params.id,
        ownerId,
      });

      if (!data) {
        return reply.notFound('Pipeline not found');
      }

      return reply.send(data);
    },
  );

  // Agent performance report
  typedApp.get(
    '/api/reports/agent-performance',
    {
      onRequest: [app.authenticate, requirePermission('reports:read')],
      schema: {
        tags: ['Reports'],
        summary: 'Get agent performance report',
        querystring: z.object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          agentId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      // Agents only see their own performance
      const agentId = isAgent(request) ? request.user.sub : request.query.agentId;
      const data = await getAgentPerformance({
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        agentId,
      });
      return reply.send(data);
    },
  );

  // Lead source breakdown report
  typedApp.get(
    '/api/reports/lead-sources',
    {
      onRequest: [app.authenticate, requirePermission('reports:read')],
      schema: {
        tags: ['Reports'],
        summary: 'Get lead source breakdown report',
        querystring: z.object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const data = await getLeadSourceBreakdown({
        startDate: request.query.startDate,
        endDate: request.query.endDate,
      });
      return reply.send(data);
    },
  );

  // ─── CSV Export Endpoints ───────────────────────────────────────────────────

  // Export pipeline summary to CSV
  typedApp.get(
    '/api/reports/pipelines/:id/export/csv',
    {
      onRequest: [app.authenticate, requirePermission('reports:read')],
      schema: {
        tags: ['Reports'],
        summary: 'Export pipeline summary to CSV',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({
          ownerId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;
      const csv = await exportPipelineSummaryCsv({
        pipelineId: request.params.id,
        ownerId,
      });

      if (!csv) {
        return reply.notFound('Pipeline not found');
      }

      await createAuditLog({
        userId: request.user.sub,
        action: 'export',
        entityType: 'report',
        changes: { reportType: 'pipeline_summary', pipelineId: request.params.id, format: 'csv' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="pipeline-summary.csv"')
        .send(csv);
    },
  );

  // Export agent performance to CSV
  typedApp.get(
    '/api/reports/agent-performance/export/csv',
    {
      onRequest: [app.authenticate, requirePermission('reports:read')],
      schema: {
        tags: ['Reports'],
        summary: 'Export agent performance to CSV',
        querystring: z.object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          agentId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const agentId = isAgent(request) ? request.user.sub : request.query.agentId;
      const csv = await exportAgentPerformanceCsv({
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        agentId,
      });

      await createAuditLog({
        userId: request.user.sub,
        action: 'export',
        entityType: 'report',
        changes: { reportType: 'agent_performance', format: 'csv' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="agent-performance.csv"')
        .send(csv);
    },
  );

  // Export lead source breakdown to CSV
  typedApp.get(
    '/api/reports/lead-sources/export/csv',
    {
      onRequest: [app.authenticate, requirePermission('reports:read')],
      schema: {
        tags: ['Reports'],
        summary: 'Export lead source breakdown to CSV',
        querystring: z.object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const csv = await exportLeadSourceCsv({
        startDate: request.query.startDate,
        endDate: request.query.endDate,
      });

      await createAuditLog({
        userId: request.user.sub,
        action: 'export',
        entityType: 'report',
        changes: { reportType: 'lead_source', format: 'csv' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="lead-sources.csv"')
        .send(csv);
    },
  );
}
