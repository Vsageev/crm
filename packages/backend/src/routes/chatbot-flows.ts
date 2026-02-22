import type { FastifyInstance } from 'fastify';
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
  // List flows (optionally filtered by botId)
  app.get<{ Querystring: { botId?: string } }>(
    '/api/chatbot-flows',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (request, reply) => {
      const flows = await listFlows(request.query.botId);
      return reply.send({ entries: flows });
    },
  );

  // Get single flow with steps
  app.get<{ Params: { id: string } }>(
    '/api/chatbot-flows/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (request, reply) => {
      const flow = await getFlowById(request.params.id);
      if (!flow) {
        return reply.notFound('Chatbot flow not found');
      }
      return reply.send(flow);
    },
  );

  // Create flow
  app.post(
    '/api/chatbot-flows',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = createFlowBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const flow = await createFlow(parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(flow);
    },
  );

  // Update flow
  app.patch<{ Params: { id: string } }>(
    '/api/chatbot-flows/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = updateFlowBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const flow = await updateFlow(request.params.id, parsed.data, {
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
  app.delete<{ Params: { id: string } }>(
    '/api/chatbot-flows/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
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
