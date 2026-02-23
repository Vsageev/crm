import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listAutomationRules,
  getAutomationRuleById,
  createAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
} from '../services/automation-rules.js';

const triggerValues = [
  'contact_created',
  'deal_created',
  'deal_stage_changed',
  'message_received',
  'tag_added',
  'task_completed',
  'conversation_created',
] as const;

const actionValues = [
  'assign_agent',
  'create_task',
  'send_message',
  'move_deal',
  'add_tag',
  'send_notification',
  'create_deal',
] as const;

const conditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'in', 'not_in']),
  value: z.unknown(),
});

const createAutomationRuleBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  trigger: z.enum(triggerValues),
  conditions: z.array(conditionSchema).optional(),
  action: z.enum(actionValues),
  actionParams: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
});

const updateAutomationRuleBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  trigger: z.enum(triggerValues).optional(),
  conditions: z.array(conditionSchema).optional(),
  action: z.enum(actionValues).optional(),
  actionParams: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
});

export async function automationRuleRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // GET /api/automation-rules
  typedApp.get(
    '/api/automation-rules',
    {
      onRequest: [app.authenticate, requirePermission('automation:read')],
      schema: {
        tags: ['Automation Rules'],
        summary: 'List automation rules',
        querystring: z.object({
          trigger: z.string().optional(),
          action: z.string().optional(),
          isActive: z.string().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listAutomationRules({
        trigger: request.query.trigger,
        action: request.query.action,
        isActive:
          request.query.isActive !== undefined
            ? request.query.isActive === 'true'
            : undefined,
        search: request.query.search,
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

  // GET /api/automation-rules/:id
  typedApp.get(
    '/api/automation-rules/:id',
    {
      onRequest: [app.authenticate, requirePermission('automation:read')],
      schema: {
        tags: ['Automation Rules'],
        summary: 'Get automation rule by ID',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const rule = await getAutomationRuleById(request.params.id);
      if (!rule) {
        return reply.notFound('Automation rule not found');
      }
      return reply.send(rule);
    },
  );

  // POST /api/automation-rules
  typedApp.post(
    '/api/automation-rules',
    {
      onRequest: [app.authenticate, requirePermission('automation:create')],
      schema: {
        tags: ['Automation Rules'],
        summary: 'Create an automation rule',
        body: createAutomationRuleBody,
      },
    },
    async (request, reply) => {
      const rule = await createAutomationRule(
        {
          ...request.body,
          createdById: request.user.sub,
        },
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      return reply.status(201).send(rule);
    },
  );

  // PATCH /api/automation-rules/:id
  typedApp.patch(
    '/api/automation-rules/:id',
    {
      onRequest: [app.authenticate, requirePermission('automation:update')],
      schema: {
        tags: ['Automation Rules'],
        summary: 'Update an automation rule',
        params: z.object({ id: z.uuid() }),
        body: updateAutomationRuleBody,
      },
    },
    async (request, reply) => {
      const updated = await updateAutomationRule(request.params.id, request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Automation rule not found');
      }

      return reply.send(updated);
    },
  );

  // DELETE /api/automation-rules/:id
  typedApp.delete(
    '/api/automation-rules/:id',
    {
      onRequest: [app.authenticate, requirePermission('automation:delete')],
      schema: {
        tags: ['Automation Rules'],
        summary: 'Delete an automation rule',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const deleted = await deleteAutomationRule(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Automation rule not found');
      }

      return reply.status(204).send();
    },
  );
}
