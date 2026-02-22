import type { FastifyInstance } from 'fastify';
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
  // GET /api/automation-rules
  app.get<{
    Querystring: {
      trigger?: string;
      action?: string;
      isActive?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/automation-rules',
    { onRequest: [app.authenticate, requirePermission('automation:read')] },
    async (request, reply) => {
      const { entries, total } = await listAutomationRules({
        trigger: request.query.trigger,
        action: request.query.action,
        isActive:
          request.query.isActive !== undefined
            ? request.query.isActive === 'true'
            : undefined,
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

  // GET /api/automation-rules/:id
  app.get<{ Params: { id: string } }>(
    '/api/automation-rules/:id',
    { onRequest: [app.authenticate, requirePermission('automation:read')] },
    async (request, reply) => {
      const rule = await getAutomationRuleById(request.params.id);
      if (!rule) {
        return reply.notFound('Automation rule not found');
      }
      return reply.send(rule);
    },
  );

  // POST /api/automation-rules
  app.post(
    '/api/automation-rules',
    { onRequest: [app.authenticate, requirePermission('automation:create')] },
    async (request, reply) => {
      const parsed = createAutomationRuleBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const rule = await createAutomationRule(
        {
          ...parsed.data,
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
  app.patch<{ Params: { id: string } }>(
    '/api/automation-rules/:id',
    { onRequest: [app.authenticate, requirePermission('automation:update')] },
    async (request, reply) => {
      const parsed = updateAutomationRuleBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const updated = await updateAutomationRule(request.params.id, parsed.data, {
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
  app.delete<{ Params: { id: string } }>(
    '/api/automation-rules/:id',
    { onRequest: [app.authenticate, requirePermission('automation:delete')] },
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
