import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { listAgentRuns, getActiveRuns, getAgentRun } from '../services/agent-runs.js';

export async function agentRunRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/api/agent-runs',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agent Runs'],
        summary: 'List agent runs with optional filters',
        querystring: z.object({
          status: z.enum(['running', 'completed', 'error']).optional(),
          agentId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request, reply) => {
      const { status, agentId, limit, offset } = request.query;
      const result = listAgentRuns({ status, agentId, limit, offset });
      return reply.send({ ...result, limit, offset });
    },
  );

  typedApp.get(
    '/api/agent-runs/active',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agent Runs'],
        summary: 'Get currently active (running) agent runs',
      },
    },
    async (_request, reply) => {
      const entries = getActiveRuns();
      return reply.send({ entries });
    },
  );

  typedApp.get(
    '/api/agent-runs/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agent Runs'],
        summary: 'Get a single agent run by ID (includes logs)',
        params: z.object({
          id: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const run = getAgentRun(request.params.id);
      if (!run) {
        return reply.status(404).send({ error: 'Agent run not found' });
      }
      return reply.send(run);
    },
  );
}
