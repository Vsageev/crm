import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listFlows,
  getFlowById,
  createFlow,
  updateFlow,
  deleteFlow,
} from '../services/chatbot-flows.js';

const stepSchema = z.object({
  id: z.string().uuid().optional(),
  stepOrder: z.number().int().min(0),
  type: z.enum([
    'send_message',
    'ask_question',
    'buttons',
    'condition',
    'assign_agent',
    'add_tag',
    'close_conversation',
  ]),
  message: z.string().max(4096).nullable().optional(),
  options: z.record(z.string(), z.unknown()).nullable().optional(),
  nextStepId: z.string().uuid().nullable().optional(),
});

const createFlowBody = z.object({
  botId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1024).nullable().optional(),
  status: z.enum(['active', 'inactive', 'draft']).optional(),
  triggerOnNewConversation: z.boolean().optional(),
  steps: z.array(stepSchema).optional(),
});

const updateFlowBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1024).nullable().optional(),
  status: z.enum(['active', 'inactive', 'draft']).optional(),
  triggerOnNewConversation: z.boolean().optional(),
  steps: z.array(stepSchema).optional(),
});

export async function chatbotFlowRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List flows (optionally filtered by botId)
  typedApp.get(
    '/api/chatbot-flows',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Chatbot Flows'],
        summary: 'List chatbot flows',
        querystring: z.object({
          botId: z.string().uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const flows = await listFlows(request.query.botId);
      return reply.send({ entries: flows });
    },
  );

  // Get single flow with steps
  typedApp.get(
    '/api/chatbot-flows/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Chatbot Flows'],
        summary: 'Get chatbot flow by ID',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const flow = await getFlowById(request.params.id);
      if (!flow) {
        return reply.notFound('Chatbot flow not found');
      }
      return reply.send(flow);
    },
  );

  // Create flow
  typedApp.post(
    '/api/chatbot-flows',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Chatbot Flows'],
        summary: 'Create a chatbot flow',
        body: createFlowBody,
      },
    },
    async (request, reply) => {
      const flow = await createFlow(request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(flow);
    },
  );

  // Update flow
  typedApp.patch(
    '/api/chatbot-flows/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Chatbot Flows'],
        summary: 'Update a chatbot flow',
        params: z.object({ id: z.uuid() }),
        body: updateFlowBody,
      },
    },
    async (request, reply) => {
      const flow = await updateFlow(request.params.id, request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!flow) {
        return reply.notFound('Chatbot flow not found');
      }

      return reply.send(flow);
    },
  );

  // Delete flow
  typedApp.delete(
    '/api/chatbot-flows/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Chatbot Flows'],
        summary: 'Delete a chatbot flow',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const deleted = await deleteFlow(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Chatbot flow not found');
      }

      return reply.status(204).send();
    },
  );
}
