import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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

function parsePagination(query: { limit?: number; offset?: number }) {
  const limit = query.limit !== undefined ? Math.min(Math.max(query.limit || 50, 1), 100) : 50;
  const offset = query.offset !== undefined ? Math.max(query.offset || 0, 0) : 0;
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
// Pagination querystring schema
// ---------------------------------------------------------------------------

const paginationQuery = z.object({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
  countOnly: z.coerce.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Public API v1 Routes
// ---------------------------------------------------------------------------

export async function publicApiRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Apply API-specific rate limits to all public API v1 routes
  const rl = apiRateLimitConfig();

  // =========================================================================
  // CONTACTS
  // =========================================================================

  // List contacts
  typedApp.get(
    '/api/v1/contacts',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'List contacts',
        querystring: paginationQuery.extend({
          ownerId: z.string().optional(),
          companyId: z.string().optional(),
          source: z.string().optional(),
          search: z.string().optional(),
        }),
      },
    },
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
        countOnly: request.query.countOnly,
      });

      if (request.query.countOnly) {
        return reply.send({ total });
      }

      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single contact
  typedApp.get(
    '/api/v1/contacts/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Get a single contact',
        params: z.object({ id: z.uuid() }),
      },
    },
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
  typedApp.post(
    '/api/v1/contacts',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:create')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Create a contact',
        body: createContactBody,
      },
    },
    async (request, reply) => {
      const data = isAgent(request)
        ? { ...request.body, ownerId: request.user.sub }
        : request.body;

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
  typedApp.patch(
    '/api/v1/contacts/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:update')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Update a contact',
        params: z.object({ id: z.uuid() }),
        body: updateContactBody,
      },
    },
    async (request, reply) => {
      if (isAgent(request)) {
        const contact = await getContactById(request.params.id) as any;
        if (!contact) return reply.notFound('Contact not found');
        if (contact.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        if (request.body.ownerId !== undefined && request.body.ownerId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign contact ownership');
        }
      }

      const updated = await updateContact(request.params.id, request.body, auditMeta(request)) as any;
      if (!updated) return reply.notFound('Contact not found');

      if (request.body.tagIds && request.body.tagIds.length > 0) {
        eventBus.emit('tag_added', {
          contactId: updated.id,
          tagIds: request.body.tagIds,
          contact: updated as unknown as Record<string, unknown>,
        });
      }

      return reply.send(updated);
    },
  );

  // Delete contact
  typedApp.delete(
    '/api/v1/contacts/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:delete')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Delete a contact',
        params: z.object({ id: z.uuid() }),
      },
    },
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
  typedApp.get(
    '/api/v1/deals',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'List deals',
        querystring: paginationQuery.extend({
          ownerId: z.string().optional(),
          contactId: z.string().optional(),
          companyId: z.string().optional(),
          pipelineId: z.string().optional(),
          pipelineStageId: z.string().optional(),
          stage: z.string().optional(),
          search: z.string().optional(),
        }),
      },
    },
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
        countOnly: request.query.countOnly,
      });

      if (request.query.countOnly) {
        return reply.send({ total });
      }

      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single deal
  typedApp.get(
    '/api/v1/deals/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Get a single deal',
        params: z.object({ id: z.uuid() }),
      },
    },
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
  typedApp.post(
    '/api/v1/deals',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:create')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Create a deal',
        body: createDealBody,
      },
    },
    async (request, reply) => {
      const data = isAgent(request)
        ? { ...request.body, ownerId: request.user.sub }
        : request.body;

      const deal = await createDeal(data, auditMeta(request)) as any;

      eventBus.emit('deal_created', {
        dealId: deal.id,
        deal: deal as unknown as Record<string, unknown>,
      });

      return reply.status(201).send(deal);
    },
  );

  // Update deal
  typedApp.patch(
    '/api/v1/deals/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:update')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Update a deal',
        params: z.object({ id: z.uuid() }),
        body: updateDealBody,
      },
    },
    async (request, reply) => {
      if (isAgent(request)) {
        const deal = await getDealById(request.params.id) as any;
        if (!deal) return reply.notFound('Deal not found');
        if (deal.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        if (request.body.ownerId !== undefined && request.body.ownerId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign deal ownership');
        }
      }

      const updated = await updateDeal(request.params.id, request.body, auditMeta(request)) as any;
      if (!updated) return reply.notFound('Deal not found');

      return reply.send(updated);
    },
  );

  // Delete deal
  typedApp.delete(
    '/api/v1/deals/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:delete')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Delete a deal',
        params: z.object({ id: z.uuid() }),
      },
    },
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
  typedApp.get(
    '/api/v1/tasks',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'List tasks',
        querystring: paginationQuery.extend({
          assigneeId: z.string().optional(),
          contactId: z.string().optional(),
          dealId: z.string().optional(),
          status: z.string().optional(),
          priority: z.string().optional(),
          type: z.string().optional(),
          overdue: z.string().optional(),
          search: z.string().optional(),
        }),
      },
    },
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
        countOnly: request.query.countOnly,
      });

      if (request.query.countOnly) {
        return reply.send({ total });
      }

      return reply.send({ total, limit, offset, entries });
    },
  );

  // Get single task
  typedApp.get(
    '/api/v1/tasks/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Get a single task',
        params: z.object({ id: z.uuid() }),
      },
    },
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
  typedApp.post(
    '/api/v1/tasks',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:create')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Create a task',
        body: createTaskBody,
      },
    },
    async (request, reply) => {
      const data = isAgent(request)
        ? { ...request.body, assigneeId: request.user.sub }
        : request.body;

      const task = await createTask(data, auditMeta(request)) as any;

      return reply.status(201).send(task);
    },
  );

  // Update task
  typedApp.patch(
    '/api/v1/tasks/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:update')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Update a task',
        params: z.object({ id: z.uuid() }),
        body: updateTaskBody,
      },
    },
    async (request, reply) => {
      if (isAgent(request)) {
        const task = await getTaskById(request.params.id) as any;
        if (!task) return reply.notFound('Task not found');
        if (task.assigneeId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        if (request.body.assigneeId !== undefined && request.body.assigneeId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign tasks');
        }
      }

      const updated = await updateTask(request.params.id, request.body, auditMeta(request)) as any;
      if (!updated) return reply.notFound('Task not found');

      if (request.body.status === 'completed') {
        eventBus.emit('task_completed', {
          taskId: updated.id,
          task: updated as unknown as Record<string, unknown>,
        });
      }

      return reply.send(updated);
    },
  );

  // Delete task
  typedApp.delete(
    '/api/v1/tasks/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:delete')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Delete a task',
        params: z.object({ id: z.uuid() }),
      },
    },
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
  typedApp.get(
    '/api/v1/messages',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('messages:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'List messages for a conversation',
        querystring: paginationQuery.extend({
          conversationId: z.string(),
        }),
      },
    },
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
  typedApp.get(
    '/api/v1/messages/:id',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('messages:read')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Get a single message',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const message = await getMessageById(request.params.id);
      if (!message) return reply.notFound('Message not found');
      return reply.send(message);
    },
  );

  // Send a message
  typedApp.post(
    '/api/v1/messages',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('messages:send')],
      config: { rateLimit: rl },
      schema: {
        tags: ['Public API'],
        summary: 'Send a message',
        body: sendMessageBody,
      },
    },
    async (request, reply) => {
      const message = await sendMessage(
        {
          ...request.body,
          senderId: request.user.sub,
        },
        auditMeta(request),
      ) as any;

      if (!message) {
        return reply.notFound('Conversation not found');
      }

      if (request.body.direction === 'inbound') {
        const conversation = await getConversationById(request.body.conversationId) as any;
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
