import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { validateWebhookUrl } from '../utils/url-validator.js';
import {
  listWebhooks,
  getWebhookById,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from '../services/webhooks.js';
import {
  listDeliveries,
  getDeliveryById,
  retryDelivery,
} from '../services/webhook-delivery.js';
import type { CrmEventName } from '../services/event-bus.js';

const eventValues = [
  'contact_created',
  'deal_created',
  'deal_stage_changed',
  'message_received',
  'tag_added',
  'task_completed',
  'conversation_created',
  '*',
] as const;

const createWebhookBody = z.object({
  url: z.url().max(2048),
  description: z.string().optional(),
  events: z
    .array(z.enum(eventValues))
    .min(1, 'At least one event is required'),
  secret: z.string().min(16).max(255).optional(),
  isActive: z.boolean().optional(),
});

const updateWebhookBody = z.object({
  url: z.url().max(2048).optional(),
  description: z.string().nullable().optional(),
  events: z
    .array(z.enum(eventValues))
    .min(1, 'At least one event is required')
    .optional(),
  secret: z.string().min(16).max(255).optional(),
  isActive: z.boolean().optional(),
});

export async function webhookRoutes(app: FastifyInstance) {
  // GET /api/webhooks
  app.get<{
    Querystring: {
      isActive?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/webhooks',
    { onRequest: [app.authenticate, requirePermission('webhooks:read')] },
    async (request, reply) => {
      const { entries, total } = await listWebhooks({
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

  // GET /api/webhooks/events — list available event types
  app.get(
    '/api/webhooks/events',
    { onRequest: [app.authenticate, requirePermission('webhooks:read')] },
    async (_request, reply) => {
      const events: { name: CrmEventName | '*'; description: string }[] = [
        { name: 'contact_created', description: 'Fired when a new contact is created' },
        { name: 'deal_created', description: 'Fired when a new deal is created' },
        { name: 'deal_stage_changed', description: 'Fired when a deal moves to a different stage' },
        { name: 'message_received', description: 'Fired when a new message is received' },
        { name: 'tag_added', description: 'Fired when tags are added to a contact' },
        { name: 'task_completed', description: 'Fired when a task is marked as completed' },
        { name: 'conversation_created', description: 'Fired when a new conversation is created' },
        { name: '*', description: 'Subscribe to all events' },
      ];

      return reply.send({ events });
    },
  );

  // GET /api/webhooks/:id
  app.get<{ Params: { id: string } }>(
    '/api/webhooks/:id',
    { onRequest: [app.authenticate, requirePermission('webhooks:read')] },
    async (request, reply) => {
      const webhook = await getWebhookById(request.params.id);
      if (!webhook) {
        return reply.notFound('Webhook not found');
      }
      return reply.send(webhook);
    },
  );

  // POST /api/webhooks
  app.post(
    '/api/webhooks',
    { onRequest: [app.authenticate, requirePermission('webhooks:create')] },
    async (request, reply) => {
      const parsed = createWebhookBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // SSRF protection: validate webhook URL (OWASP A10:2021)
      const urlCheck = validateWebhookUrl(parsed.data.url);
      if (!urlCheck.valid) {
        return reply.badRequest(urlCheck.error!);
      }

      const webhook = await createWebhook(
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

      return reply.status(201).send(webhook);
    },
  );

  // PATCH /api/webhooks/:id
  app.patch<{ Params: { id: string } }>(
    '/api/webhooks/:id',
    { onRequest: [app.authenticate, requirePermission('webhooks:update')] },
    async (request, reply) => {
      const parsed = updateWebhookBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // SSRF protection on URL update
      if (parsed.data.url) {
        const urlCheck = validateWebhookUrl(parsed.data.url);
        if (!urlCheck.valid) {
          return reply.badRequest(urlCheck.error!);
        }
      }

      const updated = await updateWebhook(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Webhook not found');
      }

      return reply.send(updated);
    },
  );

  // DELETE /api/webhooks/:id
  app.delete<{ Params: { id: string } }>(
    '/api/webhooks/:id',
    { onRequest: [app.authenticate, requirePermission('webhooks:delete')] },
    async (request, reply) => {
      const deleted = await deleteWebhook(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Webhook not found');
      }

      return reply.status(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // Webhook delivery log endpoints
  // -------------------------------------------------------------------------

  // GET /api/webhooks/:id/deliveries — list deliveries for a specific webhook
  app.get<{
    Params: { id: string };
    Querystring: {
      event?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/webhooks/:id/deliveries',
    { onRequest: [app.authenticate, requirePermission('webhooks:read')] },
    async (request, reply) => {
      const webhook = await getWebhookById(request.params.id);
      if (!webhook) {
        return reply.notFound('Webhook not found');
      }

      const { entries, total } = await listDeliveries({
        webhookId: request.params.id,
        event: request.query.event,
        status: request.query.status,
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

  // GET /api/webhook-deliveries/:id — get a single delivery by ID
  app.get<{ Params: { id: string } }>(
    '/api/webhook-deliveries/:id',
    { onRequest: [app.authenticate, requirePermission('webhooks:read')] },
    async (request, reply) => {
      const delivery = await getDeliveryById(request.params.id);
      if (!delivery) {
        return reply.notFound('Delivery not found');
      }
      return reply.send(delivery);
    },
  );

  // POST /api/webhook-deliveries/:id/retry — manually retry a failed delivery
  app.post<{ Params: { id: string } }>(
    '/api/webhook-deliveries/:id/retry',
    { onRequest: [app.authenticate, requirePermission('webhooks:update')] },
    async (request, reply) => {
      const delivery = await retryDelivery(request.params.id);
      if (!delivery) {
        return reply.notFound('Delivery not found');
      }
      return reply.send(delivery);
    },
  );
}
