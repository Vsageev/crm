import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List pipelines
  typedApp.get(
    '/api/pipelines',
    {
      onRequest: [app.authenticate, requirePermission('pipelines:read')],
      schema: {
        tags: ['Pipelines'],
        summary: 'List pipelines',
        querystring: z.object({
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listPipelines({
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

  // Get single pipeline
  typedApp.get(
    '/api/pipelines/:id',
    {
      onRequest: [app.authenticate, requirePermission('pipelines:read')],
      schema: {
        tags: ['Pipelines'],
        summary: 'Get a single pipeline by ID',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const pipeline = await getPipelineById(request.params.id);
      if (!pipeline) {
        return reply.notFound('Pipeline not found');
      }
      return reply.send(pipeline);
    },
  );

  // Create pipeline
  typedApp.post(
    '/api/pipelines',
    {
      onRequest: [app.authenticate, requirePermission('pipelines:create')],
      schema: {
        tags: ['Pipelines'],
        summary: 'Create a new pipeline',
        body: createPipelineBody,
      },
    },
    async (request, reply) => {
      const pipeline = await createPipeline(request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(pipeline);
    },
  );

  // Update pipeline
  typedApp.patch(
    '/api/pipelines/:id',
    {
      onRequest: [app.authenticate, requirePermission('pipelines:update')],
      schema: {
        tags: ['Pipelines'],
        summary: 'Update an existing pipeline',
        params: z.object({ id: z.uuid() }),
        body: updatePipelineBody,
      },
    },
    async (request, reply) => {
      const updated = await updatePipeline(request.params.id, request.body, {
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
  typedApp.delete(
    '/api/pipelines/:id',
    {
      onRequest: [app.authenticate, requirePermission('pipelines:delete')],
      schema: {
        tags: ['Pipelines'],
        summary: 'Delete a pipeline',
        params: z.object({ id: z.uuid() }),
      },
    },
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
