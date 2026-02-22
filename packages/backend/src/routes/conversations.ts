import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listConversations,
  getConversationById,
  createConversation,
  updateConversation,
  markConversationRead,
} from '../services/conversations.js';
import { eventBus } from '../services/event-bus.js';

const createConversationBody = z.object({
  contactId: z.uuid(),
  assigneeId: z.uuid().optional(),
  channelType: z.enum(['telegram', 'email', 'web_chat', 'whatsapp', 'instagram', 'other']),
  status: z.enum(['open', 'closed', 'archived']).optional(),
  subject: z.string().max(255).optional(),
  externalId: z.string().max(255).optional(),
  metadata: z.string().optional(),
});

const updateConversationBody = z.object({
  assigneeId: z.uuid().nullable().optional(),
  status: z.enum(['open', 'closed', 'archived']).optional(),
  subject: z.string().max(255).nullable().optional(),
  isUnread: z.boolean().optional(),
  metadata: z.string().nullable().optional(),
});

export async function conversationRoutes(app: FastifyInstance) {
  // List conversations
  app.get<{
    Querystring: {
      contactId?: string;
      assigneeId?: string;
      channelType?: string;
      status?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/conversations',
    { onRequest: [app.authenticate, requirePermission('messages:read')] },
    async (request, reply) => {
      const { entries, total } = await listConversations({
        contactId: request.query.contactId,
        assigneeId: request.query.assigneeId,
        channelType: request.query.channelType,
        status: request.query.status,
        search: request.query.search,
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

  // Get single conversation
  app.get<{ Params: { id: string } }>(
    '/api/conversations/:id',
    { onRequest: [app.authenticate, requirePermission('messages:read')] },
    async (request, reply) => {
      const conversation = await getConversationById(request.params.id);
      if (!conversation) {
        return reply.notFound('Conversation not found');
      }
      return reply.send(conversation);
    },
  );

  // Create conversation
  app.post(
    '/api/conversations',
    { onRequest: [app.authenticate, requirePermission('messages:send')] },
    async (request, reply) => {
      const parsed = createConversationBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const conversation = await createConversation(parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }) as any;

      // Emit automation trigger
      eventBus.emit('conversation_created', {
        conversationId: conversation.id,
        contactId: parsed.data.contactId,
        conversation: conversation as unknown as Record<string, unknown>,
      });

      return reply.status(201).send(conversation);
    },
  );

  // Update conversation
  app.patch<{ Params: { id: string } }>(
    '/api/conversations/:id',
    { onRequest: [app.authenticate, requirePermission('messages:send')] },
    async (request, reply) => {
      const parsed = updateConversationBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const updated = await updateConversation(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Conversation not found');
      }

      return reply.send(updated);
    },
  );

  // Mark conversation as read
  app.post<{ Params: { id: string } }>(
    '/api/conversations/:id/read',
    { onRequest: [app.authenticate, requirePermission('messages:read')] },
    async (request, reply) => {
      const updated = await markConversationRead(request.params.id);
      if (!updated) {
        return reply.notFound('Conversation not found');
      }
      return reply.send(updated);
    },
  );
}
