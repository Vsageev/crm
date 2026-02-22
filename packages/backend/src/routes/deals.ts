import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission, isAgent } from '../middleware/rbac.js';
import {
  listDeals,
  getDealById,
  createDeal,
  updateDeal,
  deleteDeal,
  moveDeal,
  reorderDeals,
} from '../services/deals.js';
import {
  sendTelegramNotification,
  formatDealStageChangeNotification,
} from '../services/telegram-notifications.js';
import { createNotification } from '../services/notifications.js';
import { eventBus } from '../services/event-bus.js';
import { store } from '../db/index.js';

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

export async function dealRoutes(app: FastifyInstance) {
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
    '/api/deals',
    { onRequest: [app.authenticate, requirePermission('deals:read')] },
    async (request, reply) => {
      // Agents can only see their own deals
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;

      const { entries, total } = await listDeals({
        ownerId,
        contactId: request.query.contactId,
        companyId: request.query.companyId,
        pipelineId: request.query.pipelineId,
        pipelineStageId: request.query.pipelineStageId,
        stage: request.query.stage,
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

  // Get single deal
  app.get<{ Params: { id: string } }>(
    '/api/deals/:id',
    { onRequest: [app.authenticate, requirePermission('deals:read')] },
    async (request, reply) => {
      const deal = await getDealById(request.params.id) as any;
      if (!deal) {
        return reply.notFound('Deal not found');
      }
      if (isAgent(request) && deal.ownerId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }
      return reply.send(deal);
    },
  );

  // Create deal
  app.post(
    '/api/deals',
    { onRequest: [app.authenticate, requirePermission('deals:create')] },
    async (request, reply) => {
      const parsed = createDealBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Agents can only create deals owned by themselves
      const data = isAgent(request)
        ? { ...parsed.data, ownerId: request.user.sub }
        : parsed.data;

      const deal = await createDeal(data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }) as any;

      // Emit automation trigger
      eventBus.emit('deal_created', {
        dealId: deal.id,
        deal: deal as unknown as Record<string, unknown>,
      });

      return reply.status(201).send(deal);
    },
  );

  // Update deal
  app.patch<{ Params: { id: string } }>(
    '/api/deals/:id',
    { onRequest: [app.authenticate, requirePermission('deals:update')] },
    async (request, reply) => {
      const parsed = updateDealBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Agents can only update their own deals
      if (isAgent(request)) {
        const deal = await getDealById(request.params.id) as any;
        if (!deal) {
          return reply.notFound('Deal not found');
        }
        if (deal.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        // Prevent agents from reassigning ownership
        if (parsed.data.ownerId !== undefined && parsed.data.ownerId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign deal ownership');
        }
      }

      const updated = await updateDeal(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }) as any;

      if (!updated) {
        return reply.notFound('Deal not found');
      }

      return reply.send(updated);
    },
  );

  // Delete deal
  app.delete<{ Params: { id: string } }>(
    '/api/deals/:id',
    { onRequest: [app.authenticate, requirePermission('deals:delete')] },
    async (request, reply) => {
      // Agents can only delete their own deals
      if (isAgent(request)) {
        const deal = await getDealById(request.params.id) as any;
        if (!deal) {
          return reply.notFound('Deal not found');
        }
        if (deal.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
      }

      const deleted = await deleteDeal(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Deal not found');
      }

      return reply.status(204).send();
    },
  );

  // Move deal to a different pipeline stage
  const moveDealBody = z.object({
    pipelineStageId: z.uuid(),
    stageOrder: z.number().int().min(0).optional(),
    lostReason: z.string().max(500).optional(),
  });

  app.post<{ Params: { id: string } }>(
    '/api/deals/:id/move',
    { onRequest: [app.authenticate, requirePermission('deals:update')] },
    async (request, reply) => {
      const parsed = moveDealBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Agents can only move their own deals
      if (isAgent(request)) {
        const deal = await getDealById(request.params.id) as any;
        if (!deal) {
          return reply.notFound('Deal not found');
        }
        if (deal.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
      }

      try {
        // Capture previous stage for automation trigger
        const dealBefore = await getDealById(request.params.id) as any;
        const previousStageId = dealBefore?.pipelineStageId ?? null;

        const updated = await moveDeal(request.params.id, parsed.data, {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }) as any;

        if (!updated) {
          return reply.notFound('Deal not found');
        }

        const stage = store.getById('pipelineStages', parsed.data.pipelineStageId);
        const stageName = (stage?.name as string) ?? 'Unknown';

        // Emit automation trigger
        eventBus.emit('deal_stage_changed', {
          dealId: updated.id,
          deal: updated as unknown as Record<string, unknown>,
          previousStageId,
          newStageId: parsed.data.pipelineStageId,
          stageName,
        });

        // Notify deal owner via Telegram about stage change (fire-and-forget)
        if (updated.ownerId) {
          // In-app notification
          createNotification({
            userId: updated.ownerId as string,
            type: 'deal_update',
            title: `Deal moved: ${updated.title}`,
            message: `Deal "${updated.title}" was moved to stage "${stageName}".`,
            entityType: 'deal',
            entityId: updated.id as string,
          }).catch(() => {});

          // Telegram notification
          sendTelegramNotification(
            updated.ownerId as string,
            formatDealStageChangeNotification(updated, stageName),
            'notifyDealStageChange',
          ).catch(() => {});
        }

        return reply.send(updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Move failed';
        return reply.badRequest(message);
      }
    },
  );

  // Reorder deals within a pipeline stage
  const reorderDealsBody = z.object({
    pipelineStageId: z.uuid(),
    dealOrders: z
      .array(
        z.object({
          dealId: z.uuid(),
          stageOrder: z.number().int().min(0),
        }),
      )
      .min(1),
  });

  app.post(
    '/api/deals/reorder',
    { onRequest: [app.authenticate, requirePermission('deals:update')] },
    async (request, reply) => {
      const parsed = reorderDealsBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      try {
        const updated = await reorderDeals(
          parsed.data.pipelineStageId,
          { dealOrders: parsed.data.dealOrders },
          {
            userId: request.user.sub,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          },
        );

        return reply.send({ updated: updated.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Reorder failed';
        return reply.badRequest(message);
      }
    },
  );
}
