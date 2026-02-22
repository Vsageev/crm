import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listTelegramTemplates,
  getTelegramTemplateById,
  createTelegramTemplate,
  updateTelegramTemplate,
  deleteTelegramTemplate,
} from '../services/telegram-message-templates.js';

const inlineKeyboardButtonSchema = z.object({
  text: z.string().min(1),
  url: z.string().optional(),
  callback_data: z.string().optional(),
});

const inlineKeyboardSchema = z.array(z.array(inlineKeyboardButtonSchema)).optional();

const createTelegramTemplateBody = z.object({
  name: z.string().min(1).max(255),
  content: z.string().min(1),
  parseMode: z.enum(['HTML', 'MarkdownV2']).nullable().optional(),
  inlineKeyboard: inlineKeyboardSchema,
  category: z.string().max(100).optional(),
  isGlobal: z.boolean().optional(),
});

const updateTelegramTemplateBody = z.object({
  name: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
  parseMode: z.enum(['HTML', 'MarkdownV2']).nullable().optional(),
  inlineKeyboard: inlineKeyboardSchema.nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  isGlobal: z.boolean().optional(),
});

export async function telegramMessageTemplateRoutes(app: FastifyInstance) {
  // List templates (global + own)
  app.get<{
    Querystring: {
      category?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/telegram-message-templates',
    { onRequest: [app.authenticate, requirePermission('templates:read')] },
    async (request, reply) => {
      const { entries, total } = await listTelegramTemplates({
        userId: request.user.sub,
        category: request.query.category,
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

  // Get single template
  app.get<{ Params: { id: string } }>(
    '/api/telegram-message-templates/:id',
    { onRequest: [app.authenticate, requirePermission('templates:read')] },
    async (request, reply) => {
      const template = await getTelegramTemplateById(request.params.id, request.user.sub);
      if (!template) {
        return reply.notFound('Telegram template not found');
      }
      return reply.send(template);
    },
  );

  // Create template
  app.post(
    '/api/telegram-message-templates',
    { onRequest: [app.authenticate, requirePermission('templates:create')] },
    async (request, reply) => {
      const parsed = createTelegramTemplateBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      if (parsed.data.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const template = await createTelegramTemplate(
        {
          ...parsed.data,
          createdBy: request.user.sub,
        },
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      return reply.status(201).send(template);
    },
  );

  // Update template
  app.patch<{ Params: { id: string } }>(
    '/api/telegram-message-templates/:id',
    { onRequest: [app.authenticate, requirePermission('templates:update')] },
    async (request, reply) => {
      const parsed = updateTelegramTemplateBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      if (parsed.data.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const result = await updateTelegramTemplate(
        request.params.id,
        request.user.sub,
        request.user.role,
        parsed.data,
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      if (!result) {
        return reply.notFound('Telegram template not found');
      }

      if ('forbidden' in result) {
        return reply.forbidden('You can only edit your own templates');
      }

      return reply.send(result);
    },
  );

  // Delete template
  app.delete<{ Params: { id: string } }>(
    '/api/telegram-message-templates/:id',
    { onRequest: [app.authenticate, requirePermission('templates:delete')] },
    async (request, reply) => {
      const result = await deleteTelegramTemplate(
        request.params.id,
        request.user.sub,
        request.user.role,
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      if (!result) {
        return reply.notFound('Telegram template not found');
      }

      if ('forbidden' in result) {
        return reply.forbidden('You can only delete your own templates');
      }

      return reply.status(204).send();
    },
  );
}
