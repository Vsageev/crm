import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listPipelines,
  getPipelineById,
  createPipeline,
  updatePipeline,
  deletePipeline,
} from '../services/pipelines.js';

const stageSchema = z.object({
  name: z.string().min(1).max(255),
  color: z.string().max(7).optional(),
  position: z.number().int().min(0),
  isWinStage: z.boolean().optional(),
  isLossStage: z.boolean().optional(),
});

const createPipelineBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  stages: z.array(stageSchema).min(1),
});

const updateStageSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(255),
  color: z.string().max(7).optional(),
  position: z.number().int().min(0),
  isWinStage: z.boolean().optional(),
  isLossStage: z.boolean().optional(),
});

const updatePipelineBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  stages: z.array(updateStageSchema).min(1).optional(),
});

export async function pipelineRoutes(app: FastifyInstance) {
  // List pipelines
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/pipelines',
    { onRequest: [app.authenticate, requirePermission('pipelines:read')] },
    async (request, reply) => {
      const { entries, total } = await listPipelines({
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

  // Get single pipeline
  app.get<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    { onRequest: [app.authenticate, requirePermission('pipelines:read')] },
    async (request, reply) => {
      const pipeline = await getPipelineById(request.params.id);
      if (!pipeline) {
        return reply.notFound('Pipeline not found');
      }
      return reply.send(pipeline);
    },
  );

  // Create pipeline
  app.post(
    '/api/pipelines',
    { onRequest: [app.authenticate, requirePermission('pipelines:create')] },
    async (request, reply) => {
      const parsed = createPipelineBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const pipeline = await createPipeline(parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(pipeline);
    },
  );

  // Update pipeline
  app.patch<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    { onRequest: [app.authenticate, requirePermission('pipelines:update')] },
    async (request, reply) => {
      const parsed = updatePipelineBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const updated = await updatePipeline(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Pipeline not found');
      }

      return reply.send(updated);
    },
  );

  // Delete pipeline
  app.delete<{ Params: { id: string } }>(
    '/api/pipelines/:id',
    { onRequest: [app.authenticate, requirePermission('pipelines:delete')] },
    async (request, reply) => {
      const deleted = await deletePipeline(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Pipeline not found');
      }

      return reply.status(204).send();
    },
  );
}
