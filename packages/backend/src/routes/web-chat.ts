import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // ========= Authenticated admin routes =========

  // List all widgets
  typedApp.get(
    '/api/web-chat/widgets',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Web Chat'], summary: 'List all widgets' } },
    async (_request, reply) => {
      const widgets = await listWebChatWidgets();
      return reply.send({ entries: widgets });
    },
  );

  // Get single widget
  typedApp.get(
    '/api/web-chat/widgets/:id',
    { onRequest: [app.authenticate, requirePermission('settings:read')], schema: { tags: ['Web Chat'], summary: 'Get single widget', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const widget = await getWebChatWidgetById(request.params.id);
      if (!widget) {
        return reply.notFound('Widget not found');
      }
      return reply.send(widget);
    },
  );

  // Create widget
  typedApp.post(
    '/api/web-chat/widgets',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Web Chat'], summary: 'Create widget', body: createWidgetBody } },
    async (request, reply) => {
      const widget = await createWebChatWidget(request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(widget);
    },
  );

  // Update widget
  typedApp.patch(
    '/api/web-chat/widgets/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Web Chat'], summary: 'Update widget', params: z.object({ id: z.uuid() }), body: updateWidgetBody } },
    async (request, reply) => {
      const widget = await updateWebChatWidget(request.params.id, request.body, {
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
  typedApp.delete(
    '/api/web-chat/widgets/:id',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['Web Chat'], summary: 'Delete widget', params: z.object({ id: z.uuid() }) } },
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
  typedApp.get(
    '/api/public/web-chat/:id/config',
    { schema: { tags: ['Web Chat'], summary: 'Get public widget config', params: z.object({ id: z.uuid() }) } },
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
  typedApp.post(
    '/api/public/web-chat/:id/messages',
    { schema: { tags: ['Web Chat'], summary: 'Send message from visitor', params: z.object({ id: z.uuid() }), body: visitorMessageBody } },
    async (request, reply) => {
      const result = await handleVisitorMessage(
        request.params.id,
        request.body.sessionId,
        request.body.content,
        {
          name: request.body.visitorName,
          email: request.body.visitorEmail,
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
  typedApp.get(
    '/api/public/web-chat/:id/messages',
    { schema: { tags: ['Web Chat'], summary: 'Get messages for a visitor session', params: z.object({ id: z.uuid() }), querystring: visitorMessagesQuery } },
    async (request, reply) => {
      const result = await getVisitorMessages(request.query.sessionId);

      return reply
        .header('Access-Control-Allow-Origin', '*')
        .send(result);
    },
  );

  // CORS preflight for public endpoints
  typedApp.options(
    '/api/public/web-chat/:id/config',
    { schema: { tags: ['Web Chat'], summary: 'CORS preflight for widget config' } },
    async (_request, reply) => {
      return reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type')
        .status(204)
        .send();
    },
  );

  typedApp.options(
    '/api/public/web-chat/:id/messages',
    { schema: { tags: ['Web Chat'], summary: 'CORS preflight for widget messages' } },
    async (_request, reply) => {
      return reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type')
        .status(204)
        .send();
    },
  );
}
