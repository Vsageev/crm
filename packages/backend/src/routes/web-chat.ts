import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  createWebChatWidget,
  updateWebChatWidget,
  deleteWebChatWidget,
  listWebChatWidgets,
  getWebChatWidgetById,
  getPublicWidgetConfig,
  handleVisitorMessage,
  getVisitorMessages,
} from '../services/web-chat.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createWidgetBody = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  welcomeMessage: z.string().max(2000).optional(),
  placeholderText: z.string().max(255).optional(),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  position: z.enum(['bottom-right', 'bottom-left']).optional(),
  autoGreetingEnabled: z.boolean().optional(),
  autoGreetingDelaySec: z.string().optional(),
  requireEmail: z.boolean().optional(),
  requireName: z.boolean().optional(),
  allowedOrigins: z.string().max(2000).optional(),
});

const updateWidgetBody = z.object({
  name: z.string().min(1).max(255).optional(),
  welcomeMessage: z.string().max(2000).optional(),
  placeholderText: z.string().max(255).optional(),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
  position: z.enum(['bottom-right', 'bottom-left']).optional(),
  autoGreetingEnabled: z.boolean().optional(),
  autoGreetingDelaySec: z.string().optional(),
  requireEmail: z.boolean().optional(),
  requireName: z.boolean().optional(),
  allowedOrigins: z.string().max(2000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const visitorMessageBody = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  content: z.string().min(1, 'Message content is required').max(5000),
  visitorName: z.string().max(255).optional(),
  visitorEmail: z.string().email().optional(),
});

const visitorMessagesQuery = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function webChatRoutes(app: FastifyInstance) {
  // ========= Authenticated admin routes =========

  // List all widgets
  app.get(
    '/api/web-chat/widgets',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (_request, reply) => {
      const widgets = await listWebChatWidgets();
      return reply.send({ entries: widgets });
    },
  );

  // Get single widget
  app.get<{ Params: { id: string } }>(
    '/api/web-chat/widgets/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')] },
    async (request, reply) => {
      const widget = await getWebChatWidgetById(request.params.id);
      if (!widget) {
        return reply.notFound('Widget not found');
      }
      return reply.send(widget);
    },
  );

  // Create widget
  app.post(
    '/api/web-chat/widgets',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = createWidgetBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const widget = await createWebChatWidget(parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(widget);
    },
  );

  // Update widget
  app.patch<{ Params: { id: string } }>(
    '/api/web-chat/widgets/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const parsed = updateWidgetBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const widget = await updateWebChatWidget(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!widget) {
        return reply.notFound('Widget not found');
      }

      return reply.send(widget);
    },
  );

  // Delete widget
  app.delete<{ Params: { id: string } }>(
    '/api/web-chat/widgets/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')] },
    async (request, reply) => {
      const deleted = await deleteWebChatWidget(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Widget not found');
      }

      return reply.status(204).send();
    },
  );

  // ========= Public widget endpoints (no auth) =========

  // Get widget config (public)
  app.get<{ Params: { id: string } }>(
    '/api/public/web-chat/:id/config',
    async (request, reply) => {
      const config = await getPublicWidgetConfig(request.params.id);
      if (!config) {
        return reply.notFound('Widget not found or inactive');
      }

      return reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Cache-Control', 'public, max-age=60')
        .send(config);
    },
  );

  // Send message from visitor (public)
  app.post<{ Params: { id: string } }>(
    '/api/public/web-chat/:id/messages',
    async (request, reply) => {
      const parsed = visitorMessageBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const result = await handleVisitorMessage(
        request.params.id,
        parsed.data.sessionId,
        parsed.data.content,
        {
          name: parsed.data.visitorName,
          email: parsed.data.visitorEmail,
        },
      );

      if (!result.ok) {
        return reply.badRequest(result.error);
      }

      return reply
        .header('Access-Control-Allow-Origin', '*')
        .status(201)
        .send(result);
    },
  );

  // Get messages for a visitor session (public, for polling)
  app.get<{ Params: { id: string }; Querystring: { sessionId: string } }>(
    '/api/public/web-chat/:id/messages',
    async (request, reply) => {
      const parsed = visitorMessagesQuery.safeParse(request.query);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const result = await getVisitorMessages(parsed.data.sessionId);

      return reply
        .header('Access-Control-Allow-Origin', '*')
        .send(result);
    },
  );

  // CORS preflight for public endpoints
  app.options('/api/public/web-chat/:id/config', async (_request, reply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .status(204)
      .send();
  });

  app.options('/api/public/web-chat/:id/messages', async (_request, reply) => {
    return reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .status(204)
      .send();
  });
}
