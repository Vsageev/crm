import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { authenticateApiKeyOrJwt, requireApiPermission } from '../middleware/api-key-auth.js';
import {
  getContactById,
  createContact,
  updateContact,
  deleteContact,
} from '../services/contacts.js';
import {
  getDealById,
  createDeal,
  updateDeal,
  deleteDeal,
} from '../services/deals.js';
import {
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
} from '../services/tasks.js';
import { store } from '../db/index.js';

const MAX_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const batchDeleteBody = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_BATCH_SIZE),
});

// ---------------------------------------------------------------------------
// Contact schemas
// ---------------------------------------------------------------------------

const contactCreateItem = z.object({
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
});

const contactUpdateItem = z.object({
  id: z.uuid(),
  data: z.object({
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
  }),
});

// ---------------------------------------------------------------------------
// Deal schemas
// ---------------------------------------------------------------------------

const dealCreateItem = z.object({
  title: z.string().min(1).max(255),
  value: z.string().optional(),
  currency: z.string().max(3).optional(),
  stage: z
    .enum(['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'])
    .optional(),
  pipelineId: z.uuid().optional(),
  pipelineStageId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  expectedCloseDate: z.iso.datetime().optional(),
  notes: z.string().optional(),
  tagIds: z.array(z.uuid()).optional(),
});

const dealUpdateItem = z.object({
  id: z.uuid(),
  data: z.object({
    title: z.string().min(1).max(255).optional(),
    value: z.string().nullable().optional(),
    currency: z.string().max(3).optional(),
    stage: z
      .enum(['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'])
      .optional(),
    pipelineId: z.uuid().nullable().optional(),
    pipelineStageId: z.uuid().nullable().optional(),
    contactId: z.uuid().nullable().optional(),
    companyId: z.uuid().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    expectedCloseDate: z.iso.datetime().nullable().optional(),
    notes: z.string().nullable().optional(),
    tagIds: z.array(z.uuid()).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Task schemas
// ---------------------------------------------------------------------------

const taskStatuses = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
const taskPriorities = ['low', 'medium', 'high'] as const;
const taskTypes = ['call', 'meeting', 'email', 'follow_up', 'other'] as const;

const taskCreateItem = z.object({
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

const taskUpdateItem = z.object({
  id: z.uuid(),
  data: z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().nullable().optional(),
    type: z.enum(taskTypes).optional(),
    status: z.enum(taskStatuses).optional(),
    priority: z.enum(taskPriorities).optional(),
    dueDate: z.iso.datetime().nullable().optional(),
    contactId: z.uuid().nullable().optional(),
    dealId: z.uuid().nullable().optional(),
    assigneeId: z.uuid().nullable().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Tag schemas
// ---------------------------------------------------------------------------

const tagCreateItem = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

const tagUpdateItem = z.object({
  id: z.uuid(),
  data: z.object({
    name: z.string().min(1).max(100).optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
  }),
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function auditMeta(request: { user: { sub: string }; ip: string; headers: Record<string, string | string[] | undefined> }) {
  return {
    userId: request.user.sub,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function batchRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // =========================================================================
  // CONTACTS
  // =========================================================================

  // Batch delete contacts
  typedApp.post(
    '/api/batch/contacts/delete',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:delete')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch delete contacts',
        body: batchDeleteBody,
      },
    },
    async (request, reply) => {
      const succeeded: string[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const id of request.body.ids) {
        try {
          const deleted = await deleteContact(id, auditMeta(request));
          if (deleted) {
            succeeded.push(id);
          } else {
            failed.push({ id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch create contacts
  typedApp.post(
    '/api/batch/contacts/create',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:create')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch create contacts',
        body: z.object({ items: z.array(contactCreateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { index: number; error: string }[] = [];

      for (let i = 0; i < request.body.items.length; i++) {
        try {
          const contact = await createContact(request.body.items[i], auditMeta(request));
          succeeded.push(contact);
        } catch (err) {
          failed.push({ index: i, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch update contacts
  typedApp.post(
    '/api/batch/contacts/update',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:update')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch update contacts',
        body: z.object({ items: z.array(contactUpdateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const item of request.body.items) {
        try {
          const updated = await updateContact(item.id, item.data, auditMeta(request));
          if (updated) {
            succeeded.push(updated);
          } else {
            failed.push({ id: item.id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id: item.id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // =========================================================================
  // DEALS
  // =========================================================================

  // Batch delete deals
  typedApp.post(
    '/api/batch/deals/delete',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:delete')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch delete deals',
        body: batchDeleteBody,
      },
    },
    async (request, reply) => {
      const succeeded: string[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const id of request.body.ids) {
        try {
          const deleted = await deleteDeal(id, auditMeta(request));
          if (deleted) {
            succeeded.push(id);
          } else {
            failed.push({ id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch create deals
  typedApp.post(
    '/api/batch/deals/create',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:create')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch create deals',
        body: z.object({ items: z.array(dealCreateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { index: number; error: string }[] = [];

      for (let i = 0; i < request.body.items.length; i++) {
        try {
          const deal = await createDeal(request.body.items[i], auditMeta(request));
          succeeded.push(deal);
        } catch (err) {
          failed.push({ index: i, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch update deals
  typedApp.post(
    '/api/batch/deals/update',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('deals:update')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch update deals',
        body: z.object({ items: z.array(dealUpdateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const item of request.body.items) {
        try {
          const updated = await updateDeal(item.id, item.data, auditMeta(request));
          if (updated) {
            succeeded.push(updated);
          } else {
            failed.push({ id: item.id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id: item.id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // =========================================================================
  // TASKS
  // =========================================================================

  // Batch delete tasks
  typedApp.post(
    '/api/batch/tasks/delete',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:delete')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch delete tasks',
        body: batchDeleteBody,
      },
    },
    async (request, reply) => {
      const succeeded: string[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const id of request.body.ids) {
        try {
          const deleted = await deleteTask(id, auditMeta(request));
          if (deleted) {
            succeeded.push(id);
          } else {
            failed.push({ id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch create tasks
  typedApp.post(
    '/api/batch/tasks/create',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:create')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch create tasks',
        body: z.object({ items: z.array(taskCreateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { index: number; error: string }[] = [];

      for (let i = 0; i < request.body.items.length; i++) {
        try {
          const task = await createTask(request.body.items[i], auditMeta(request));
          succeeded.push(task);
        } catch (err) {
          failed.push({ index: i, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch update tasks
  typedApp.post(
    '/api/batch/tasks/update',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('tasks:update')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch update tasks',
        body: z.object({ items: z.array(taskUpdateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const item of request.body.items) {
        try {
          const updated = await updateTask(item.id, item.data, auditMeta(request));
          if (updated) {
            succeeded.push(updated);
          } else {
            failed.push({ id: item.id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id: item.id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // =========================================================================
  // TAGS
  // =========================================================================

  // Batch delete tags
  typedApp.post(
    '/api/batch/tags/delete',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:delete')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch delete tags',
        body: batchDeleteBody,
      },
    },
    async (request, reply) => {
      const succeeded: string[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const id of request.body.ids) {
        try {
          const deleted = store.delete('tags', id);
          if (deleted) {
            succeeded.push(id);
          } else {
            failed.push({ id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch create tags
  typedApp.post(
    '/api/batch/tags/create',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:create')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch create tags',
        body: z.object({ items: z.array(tagCreateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { index: number; error: string }[] = [];

      for (let i = 0; i < request.body.items.length; i++) {
        try {
          const tag = store.insert('tags', request.body.items[i]);
          succeeded.push(tag);
        } catch (err) {
          failed.push({ index: i, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );

  // Batch update tags
  typedApp.post(
    '/api/batch/tags/update',
    {
      onRequest: [authenticateApiKeyOrJwt, requireApiPermission('contacts:update')],
      schema: {
        tags: ['Batch Operations'],
        summary: 'Batch update tags',
        body: z.object({ items: z.array(tagUpdateItem).min(1).max(MAX_BATCH_SIZE) }),
      },
    },
    async (request, reply) => {
      const succeeded: unknown[] = [];
      const failed: { id: string; error: string }[] = [];

      for (const item of request.body.items) {
        try {
          const updated = store.update('tags', item.id, { ...item.data, updatedAt: new Date() });
          if (updated) {
            succeeded.push(updated);
          } else {
            failed.push({ id: item.id, error: 'Not found' });
          }
        } catch (err) {
          failed.push({ id: item.id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      return reply.send({ succeeded, failed });
    },
  );
}
