import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { store } from '../db/index.js';
import { getAgent } from '../services/agents.js';
import {
  listAgentConversations,
  createAgentConversation,
  validateConversationOwnership,
  deleteAgentConversation,
  renameAgentConversation,
  saveAgentConversationMessage,
  executePrompt,
  isAgentBusy,
} from '../services/agent-chat.js';

export async function agentChatRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List conversations for an agent
  typedApp.get(
    '/api/agents/:id/chat/conversations',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agent Chat'],
        summary: 'List chat conversations for an agent',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      const { limit, offset } = request.query;
      const result = listAgentConversations(request.params.id, limit, offset);
      return reply.send(result);
    },
  );

  // Create a new conversation for an agent
  typedApp.post(
    '/api/agents/:id/chat/conversations',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agent Chat'],
        summary: 'Create a new chat conversation for an agent',
        params: z.object({ id: z.string() }),
        body: z.object({
          subject: z.string().max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      const conv = createAgentConversation(request.params.id, request.body.subject);
      return reply.status(201).send(conv);
    },
  );

  // Rename a conversation
  typedApp.patch(
    '/api/agents/:id/chat/conversations/:conversationId',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agent Chat'],
        summary: 'Rename an agent chat conversation',
        params: z.object({ id: z.string(), conversationId: z.string() }),
        body: z.object({
          subject: z.string().min(1).max(200),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      const conv = validateConversationOwnership(request.params.conversationId, request.params.id);
      if (!conv) return reply.notFound('Conversation not found');

      const updated = renameAgentConversation(request.params.conversationId, request.body.subject);
      return reply.send(updated);
    },
  );

  // Delete a conversation
  typedApp.delete(
    '/api/agents/:id/chat/conversations/:conversationId',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agent Chat'],
        summary: 'Delete an agent chat conversation and its messages',
        params: z.object({ id: z.string(), conversationId: z.string() }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      const conv = validateConversationOwnership(request.params.conversationId, request.params.id);
      if (!conv) return reply.notFound('Conversation not found');

      deleteAgentConversation(request.params.conversationId);
      return reply.status(204).send();
    },
  );

  // List chat messages for a specific conversation
  typedApp.get(
    '/api/agents/:id/chat/messages',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agent Chat'],
        summary: 'List chat messages for an agent conversation',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          conversationId: z.string(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      const conv = validateConversationOwnership(request.query.conversationId, request.params.id);
      if (!conv) return reply.notFound('Conversation not found');

      const all = store
        .find(
          'messages',
          (r: Record<string, unknown>) => r.conversationId === request.query.conversationId,
        )
        .sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            new Date(a.createdAt as string).getTime() -
            new Date(b.createdAt as string).getTime(),
        );

      const { limit, offset } = request.query;
      const entries = all.slice(offset, offset + limit);
      return reply.send({ total: all.length, limit, offset, entries });
    },
  );

  // Append a message to an agent chat conversation (for agent progress/final updates)
  typedApp.post(
    '/api/agents/:id/chat/messages',
    {
      onRequest: [app.authenticate, requirePermission('messages:send')],
      schema: {
        tags: ['Agent Chat'],
        summary: 'Append a message to an agent chat conversation',
        params: z.object({ id: z.string() }),
        body: z.object({
          conversationId: z.string(),
          content: z.string().min(1).max(50000),
          isFinal: z.boolean().optional(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      const conv = validateConversationOwnership(request.body.conversationId, request.params.id);
      if (!conv) return reply.notFound('Conversation not found');

      const message = saveAgentConversationMessage({
        conversationId: request.body.conversationId,
        direction: 'inbound',
        content: request.body.content,
        type: request.body.isFinal ? 'text' : 'system',
        metadata: {
          agentChatUpdate: true,
          isFinal: Boolean(request.body.isFinal),
        },
      });

      return reply.status(201).send(message);
    },
  );

  // Send a prompt (SSE streaming)
  typedApp.post(
    '/api/agents/:id/chat/message',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agent Chat'],
        summary: 'Send a prompt to the agent and stream the response via SSE',
        params: z.object({ id: z.string() }),
        body: z.object({
          prompt: z.string().min(1).max(50000),
          conversationId: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      if (isAgentBusy(request.params.id, request.body.conversationId)) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Agent is already processing a prompt',
        });
      }

      const conv = validateConversationOwnership(request.body.conversationId, request.params.id);
      if (!conv) return reply.notFound('Conversation not found');

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      executePrompt(request.params.id, request.body.prompt, request.body.conversationId, {
        onChunk(text) {
          reply.raw.write(`data: ${JSON.stringify(text)}\n\n`);
        },
        onDone(message) {
          reply.raw.write(`event: done\ndata: ${JSON.stringify({ messageId: message.id })}\n\n`);
          reply.raw.end();
        },
        onError(error) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
          reply.raw.end();
        },
      });
    },
  );
}
