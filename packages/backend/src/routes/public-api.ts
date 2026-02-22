import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { isAgent } from '../middleware/rbac.js';
import { authenticateApiKeyOrJwt, requireApiPermission } from '../middleware/api-key-auth.js';
import {
  listContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
} from '../services/contacts.js';
import {
  listDeals,
  getDealById,
  createDeal,
  updateDeal,
  deleteDeal,
} from '../services/deals.js';
import {
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
} from '../services/tasks.js';
import {
  listMessages,
  getMessageById,
  sendMessage,
} from '../services/messages.js';
import { getConversationById } from '../services/conversations.js';
import { eventBus } from '../services/event-bus.js';
import { apiRateLimitConfig } from '../plugins/rate-limit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePagination(query: { limit?: string; offset?: string }) {
  const limit = query.limit ? Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100) : 50;
  const offset = query.offset ? Math.max(parseInt(query.offset, 10) || 0, 0) : 0;
  return { limit, offset };
}

function auditMeta(request: { user: { sub: string }; ip: string; headers: Record<string, string | string[] | undefined> }) {
  return {
    userId: request.user.sub,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Validation schemas — Contacts
// ---------------------------------------------------------------------------

const createContactBody = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(50).optional(),
  position: z.string().max(150).optional(),
  companyId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  source: z
    .enum(['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'])
    .optional(),
  telegramId: z.string().max(50).optional(),
  notes: z.string().optional(),
  tagIds: z.array(z.uuid()).optional(),
  customFields: z
    .array(z.object({ definitionId: z.uuid(), value: z.string() }))
    .optional(),
});

const updateContactBody = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  position: z.string().max(150).nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  source: z
    .enum(['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'])
    .optional(),
  telegramId: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
  tagIds: z.array(z.uuid()).optional(),
  customFields: z
    .array(z.object({ definitionId: z.uuid(), value: z.string() }))
    .optional(),
});

// ---------------------------------------------------------------------------
// Validation schemas — Deals
// ---------------------------------------------------------------------------

const createDealBody = z.object({
  title: z.string().min(1).max(255),
  value: z.string().optional(),
  currency: z.string().max(3).optional(),
  stage: z
    .enum(['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'])
    .optional(),
  pipelineId: z.uuid().optional(),
  pipelineStageId: z.uuid().optional(),
  stageOrder: z.number().int().min(0).optional(),
  contactId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  expectedCloseDate: z.iso.datetime().optional(),
  lostReason: z.string().max(500).optional(),
  notes: z.string().optional(),
  tagIds: z.array(z.uuid()).optional(),
});

const updateDealBody = z.object({
  title: z.string().min(1).max(255).optional(),
  value: z.string().nullable().optional(),
  currency: z.string().max(3).optional(),
  stage: z
    .enum(['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'])
    .optional(),
  pipelineId: z.uuid().nullable().optional(),
  pipelineStageId: z.uuid().nullable().optional(),
  stageOrder: z.number().int().min(0).optional(),
  contactId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  expectedCloseDate: z.iso.datetime().nullable().optional(),
  closedAt: z.iso.datetime().nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
  notes: z.string().nullable().optional(),
  tagIds: z.array(z.uuid()).optional(),
});

// ---------------------------------------------------------------------------
// Validation schemas — Tasks
// ---------------------------------------------------------------------------

const taskStatuses = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
const taskPriorities = ['low', 'medium', 'high'] as const;
const taskTypes = ['call', 'meeting', 'email', 'follow_up', 'other'] as const;

const createTaskBody = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(taskTypes).optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: z.iso.datetime().optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
});

const updateTaskBody = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(taskTypes).optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Validation schemas — Messages
// ---------------------------------------------------------------------------

const sendMessageBody = z.object({
  conversationId: z.uuid(),
  direction: z.enum(['inbound', 'outbound']),
  type: z
    .enum(['text', 'image', 'video', 'document', 'voice', 'sticker', 'location', 'system'])
    .optional(),
  content: z.string().optional(),
  externalId: z.string().optional(),
  attachments: z.any().optional(),
  metadata: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Public API v1 Routes
// ---------------------------------------------------------------------------

export async function publicApiRoutes(app: FastifyInstance) {
  // Apply API-specific rate limits to all public API v1 routes
  const rl = apiRateLimitConfig();

  // =========================================================================
  // CONTACTS
  // =========================================================================

  // List contacts
  app.get<{
    Querystring: {
      ownerId?: string;
      companyId?: string;
      source?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/v1/contacts',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      const { limit, offset } = parsePagination(request.query);
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;

      const { entries, total } = await listContacts({
        ownerId,
        companyId: request.query.companyId,
        source: request.query.source,
        search: request.query.search,
        limit,
        offset,
      });

      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single contact
  app.get<{ Params: { id: string } }>(
    '/api/v1/contacts/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      const contact = await getContactById(request.params.id) as any;
      if (!contact) return reply.notFound('Contact not found');
      if (isAgent(request) && contact.ownerId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }
      return reply.send(contact);
    },
  );

  // Create contact
  app.post(
    '/api/v1/contacts',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:create')], config: { rateLimit: rl } },
    async (request, reply) => {
      const parsed = createContactBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const data = isAgent(request)
        ? { ...parsed.data, ownerId: request.user.sub }
        : parsed.data;

      const contact = await createContact(data, auditMeta(request)) as any;

      eventBus.emit('contact_created', {
        contactId: contact.id,
        contact: contact as unknown as Record<string, unknown>,
      });

      if (data.tagIds && data.tagIds.length > 0) {
        eventBus.emit('tag_added', {
          contactId: contact.id,
          tagIds: data.tagIds,
          contact: contact as unknown as Record<string, unknown>,
        });
      }

      return reply.status(201).send(contact);
    },
  );

  // Update contact
  app.patch<{ Params: { id: string } }>(
    '/api/v1/contacts/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:update')], config: { rateLimit: rl } },
    async (request, reply) => {
      const parsed = updateContactBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      if (isAgent(request)) {
        const contact = await getContactById(request.params.id) as any;
        if (!contact) return reply.notFound('Contact not found');
        if (contact.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        if (parsed.data.ownerId !== undefined && parsed.data.ownerId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign contact ownership');
        }
      }

      const updated = await updateContact(request.params.id, parsed.data, auditMeta(request)) as any;
      if (!updated) return reply.notFound('Contact not found');

      if (parsed.data.tagIds && parsed.data.tagIds.length > 0) {
        eventBus.emit('tag_added', {
          contactId: updated.id,
          tagIds: parsed.data.tagIds,
          contact: updated as unknown as Record<string, unknown>,
        });
      }

      return reply.send(updated);
    },
  );

  // Delete contact
  app.delete<{ Params: { id: string } }>(
    '/api/v1/contacts/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:delete')], config: { rateLimit: rl } },
    async (request, reply) => {
      if (isAgent(request)) {
        const contact = await getContactById(request.params.id) as any;
        if (!contact) return reply.notFound('Contact not found');
        if (contact.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
      }

      const deleted = await deleteContact(request.params.id, auditMeta(request));
      if (!deleted) return reply.notFound('Contact not found');

      return reply.status(204).send();
    },
  );

  // =========================================================================
  // DEALS
  // =========================================================================

  // List deals
  app.get<{
    Querystring: {
      ownerId?: string;
      contactId?: string;
      companyId?: string;
      pipelineId?: string;
      pipelineStageId?: string;
      stage?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/v1/deals',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      const { limit, offset } = parsePagination(request.query);
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;

      const { entries, total } = await listDeals({
        ownerId,
        contactId: request.query.contactId,
        companyId: request.query.companyId,
        pipelineId: request.query.pipelineId,
        pipelineStageId: request.query.pipelineStageId,
        stage: request.query.stage,
        search: request.query.search,
        limit,
        offset,
      });

      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single deal
  app.get<{ Params: { id: string } }>(
    '/api/v1/deals/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      const deal = await getDealById(request.params.id) as any;
      if (!deal) return reply.notFound('Deal not found');
      if (isAgent(request) && deal.ownerId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }
      return reply.send(deal);
    },
  );

  // Create deal
  app.post(
    '/api/v1/deals',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:create')], config: { rateLimit: rl } },
    async (request, reply) => {
      const parsed = createDealBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const data = isAgent(request)
        ? { ...parsed.data, ownerId: request.user.sub }
        : parsed.data;

      const deal = await createDeal(data, auditMeta(request)) as any;

      eventBus.emit('deal_created', {
        dealId: deal.id,
        deal: deal as unknown as Record<string, unknown>,
      });

      return reply.status(201).send(deal);
    },
  );

  // Update deal
  app.patch<{ Params: { id: string } }>(
    '/api/v1/deals/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:update')], config: { rateLimit: rl } },
    async (request, reply) => {
      const parsed = updateDealBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      if (isAgent(request)) {
        const deal = await getDealById(request.params.id) as any;
        if (!deal) return reply.notFound('Deal not found');
        if (deal.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        if (parsed.data.ownerId !== undefined && parsed.data.ownerId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign deal ownership');
        }
      }

      const updated = await updateDeal(request.params.id, parsed.data, auditMeta(request)) as any;
      if (!updated) return reply.notFound('Deal not found');

      return reply.send(updated);
    },
  );

  // Delete deal
  app.delete<{ Params: { id: string } }>(
    '/api/v1/deals/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:delete')], config: { rateLimit: rl } },
    async (request, reply) => {
      if (isAgent(request)) {
        const deal = await getDealById(request.params.id) as any;
        if (!deal) return reply.notFound('Deal not found');
        if (deal.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
      }

      const deleted = await deleteDeal(request.params.id, auditMeta(request));
      if (!deleted) return reply.notFound('Deal not found');

      return reply.status(204).send();
    },
  );

  // =========================================================================
  // TASKS
  // =========================================================================

  // List tasks
  app.get<{
    Querystring: {
      assigneeId?: string;
      contactId?: string;
      dealId?: string;
      status?: string;
      priority?: string;
      type?: string;
      overdue?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/v1/tasks',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      const { limit, offset } = parsePagination(request.query);
      const assigneeId = isAgent(request) ? request.user.sub : request.query.assigneeId;

      const { entries, total } = await listTasks({
        assigneeId,
        contactId: request.query.contactId,
        dealId: request.query.dealId,
        status: request.query.status,
        priority: request.query.priority,
        type: request.query.type,
        overdue: request.query.overdue === 'true',
        search: request.query.search,
        limit,
        offset,
      });

      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single task
  app.get<{ Params: { id: string } }>(
    '/api/v1/tasks/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      const task = await getTaskById(request.params.id) as any;
      if (!task) return reply.notFound('Task not found');
      if (isAgent(request) && task.assigneeId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }
      return reply.send(task);
    },
  );

  // Create task
  app.post(
    '/api/v1/tasks',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:create')], config: { rateLimit: rl } },
    async (request, reply) => {
      const parsed = createTaskBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const data = isAgent(request)
        ? { ...parsed.data, assigneeId: request.user.sub }
        : parsed.data;

      const task = await createTask(data, auditMeta(request)) as any;

      return reply.status(201).send(task);
    },
  );

  // Update task
  app.patch<{ Params: { id: string } }>(
    '/api/v1/tasks/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:update')], config: { rateLimit: rl } },
    async (request, reply) => {
      const parsed = updateTaskBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      if (isAgent(request)) {
        const task = await getTaskById(request.params.id) as any;
        if (!task) return reply.notFound('Task not found');
        if (task.assigneeId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign tasks');
        }
      }

      const updated = await updateTask(request.params.id, parsed.data, auditMeta(request)) as any;
      if (!updated) return reply.notFound('Task not found');

      if (parsed.data.status === 'completed') {
        eventBus.emit('task_completed', {
          taskId: updated.id,
          task: updated as unknown as Record<string, unknown>,
        });
      }

      return reply.send(updated);
    },
  );

  // Delete task
  app.delete<{ Params: { id: string } }>(
    '/api/v1/tasks/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:delete')], config: { rateLimit: rl } },
    async (request, reply) => {
      if (isAgent(request)) {
        const task = await getTaskById(request.params.id) as any;
        if (!task) return reply.notFound('Task not found');
        if (task.assigneeId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
      }

      const deleted = await deleteTask(request.params.id, auditMeta(request));
      if (!deleted) return reply.notFound('Task not found');

      return reply.status(204).send();
    },
  );

  // =========================================================================
  // MESSAGES
  // =========================================================================

  // List messages (requires conversationId)
  app.get<{
    Querystring: {
      conversationId: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/v1/messages',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('messages:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      if (!request.query.conversationId) {
        return reply.badRequest('conversationId query parameter is required');
      }

      const { limit, offset } = parsePagination(request.query);

      const { entries, total } = await listMessages({
        conversationId: request.query.conversationId,
        limit,
        offset,
      });

      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single message
  app.get<{ Params: { id: string } }>(
    '/api/v1/messages/:id',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('messages:read')], config: { rateLimit: rl } },
    async (request, reply) => {
      const message = await getMessageById(request.params.id);
      if (!message) return reply.notFound('Message not found');
      return reply.send(message);
    },
  );

  // Send a message
  app.post(
    '/api/v1/messages',
    { onRequest: [authenticateApiKeyOrJwt, requireApiPermission('messages:send')], config: { rateLimit: rl } },
    async (request, reply) => {
      const parsed = sendMessageBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const message = await sendMessage(
        {
          ...parsed.data,
          senderId: request.user.sub,
        },
        auditMeta(request),
      ) as any;

      if (!message) {
        return reply.notFound('Conversation not found');
      }

      if (parsed.data.direction === 'inbound') {
        const conversation = await getConversationById(parsed.data.conversationId) as any;
        if (conversation) {
          eventBus.emit('message_received', {
            messageId: message.id,
            conversationId: conversation.id,
            contactId: conversation.contactId,
            message: message as unknown as Record<string, unknown>,
          });
        }
      }

      return reply.status(201).send(message);
    },
  );
}
