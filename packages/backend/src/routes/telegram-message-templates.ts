import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List templates (global + own)
  typedApp.get(
    '/api/telegram-message-templates',
    {
      onRequest: [app.authenticate, requirePermission('templates:read')],
      schema: {
        tags: ['Telegram Message Templates'],
        summary: 'List Telegram message templates',
        querystring: z.object({
          category: z.string().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listTelegramTemplates({
        userId: request.user.sub,
        category: request.query.category,
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

  // Get single template
  typedApp.get(
    '/api/telegram-message-templates/:id',
    {
      onRequest: [app.authenticate, requirePermission('templates:read')],
      schema: {
        tags: ['Telegram Message Templates'],
        summary: 'Get single Telegram message template',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const template = await getTelegramTemplateById(request.params.id, request.user.sub);
      if (!template) {
        return reply.notFound('Telegram template not found');
      }
      return reply.send(template);
    },
  );

  // Create template
  typedApp.post(
    '/api/telegram-message-templates',
    {
      onRequest: [app.authenticate, requirePermission('templates:create')],
      schema: {
        tags: ['Telegram Message Templates'],
        summary: 'Create Telegram message template',
        body: createTelegramTemplateBody,
      },
    },
    async (request, reply) => {
      if (request.body.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const template = await createTelegramTemplate(
        {
          ...request.body,
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
  typedApp.patch(
    '/api/telegram-message-templates/:id',
    {
      onRequest: [app.authenticate, requirePermission('templates:update')],
      schema: {
        tags: ['Telegram Message Templates'],
        summary: 'Update Telegram message template',
        params: z.object({ id: z.uuid() }),
        body: updateTelegramTemplateBody,
      },
    },
    async (request, reply) => {
      if (request.body.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const result = await updateTelegramTemplate(
        request.params.id,
        request.user.sub,
        request.user.role,
        request.body,
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
  typedApp.delete(
    '/api/telegram-message-templates/:id',
    {
      onRequest: [app.authenticate, requirePermission('templates:delete')],
      schema: {
        tags: ['Telegram Message Templates'],
        summary: 'Delete Telegram message template',
        params: z.object({ id: z.uuid() }),
      },
    },
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
