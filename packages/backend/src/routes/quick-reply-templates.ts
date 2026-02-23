import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../services/quick-reply-templates.js';

const createTemplateBody = z.object({
  name: z.string().min(1).max(255),
  content: z.string().min(1),
  category: z.string().max(100).optional(),
  shortcut: z.string().max(100).optional(),
  isGlobal: z.boolean().optional(),
});

const updateTemplateBody = z.object({
  name: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
  category: z.string().max(100).nullable().optional(),
  shortcut: z.string().max(100).nullable().optional(),
  isGlobal: z.boolean().optional(),
});

export async function quickReplyTemplateRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List templates (global + own)
  typedApp.get(
    '/api/quick-reply-templates',
    {
      onRequest: [app.authenticate, requirePermission('templates:read')],
      schema: {
        tags: ['Quick Reply Templates'],
        summary: 'List quick reply templates',
        querystring: z.object({
          category: z.string().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listTemplates({
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
    '/api/quick-reply-templates/:id',
    {
      onRequest: [app.authenticate, requirePermission('templates:read')],
      schema: {
        tags: ['Quick Reply Templates'],
        summary: 'Get single quick reply template',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const template = await getTemplateById(request.params.id, request.user.sub);
      if (!template) {
        return reply.notFound('Template not found');
      }
      return reply.send(template);
    },
  );

  // Create template
  typedApp.post(
    '/api/quick-reply-templates',
    {
      onRequest: [app.authenticate, requirePermission('templates:create')],
      schema: {
        tags: ['Quick Reply Templates'],
        summary: 'Create quick reply template',
        body: createTemplateBody,
      },
    },
    async (request, reply) => {
      // Only admin/manager can create global templates
      if (request.body.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const template = await createTemplate(
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
    '/api/quick-reply-templates/:id',
    {
      onRequest: [app.authenticate, requirePermission('templates:update')],
      schema: {
        tags: ['Quick Reply Templates'],
        summary: 'Update quick reply template',
        params: z.object({ id: z.uuid() }),
        body: updateTemplateBody,
      },
    },
    async (request, reply) => {
      // Only admin/manager can set global
      if (request.body.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const result = await updateTemplate(
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
        return reply.notFound('Template not found');
      }

      if ('forbidden' in result) {
        return reply.forbidden('You can only edit your own templates');
      }

      return reply.send(result);
    },
  );

  // Delete template
  typedApp.delete(
    '/api/quick-reply-templates/:id',
    {
      onRequest: [app.authenticate, requirePermission('templates:delete')],
      schema: {
        tags: ['Quick Reply Templates'],
        summary: 'Delete quick reply template',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const result = await deleteTemplate(request.params.id, request.user.sub, request.user.role, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result) {
        return reply.notFound('Template not found');
      }

      if ('forbidden' in result) {
        return reply.forbidden('You can only delete your own templates');
      }

      return reply.status(204).send();
    },
  );
}
