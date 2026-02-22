import type { FastifyInstance } from 'fastify';
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
  // List templates (global + own)
  app.get<{
    Querystring: {
      category?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/quick-reply-templates',
    { onRequest: [app.authenticate, requirePermission('templates:read')] },
    async (request, reply) => {
      const { entries, total } = await listTemplates({
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
    '/api/quick-reply-templates/:id',
    { onRequest: [app.authenticate, requirePermission('templates:read')] },
    async (request, reply) => {
      const template = await getTemplateById(request.params.id, request.user.sub);
      if (!template) {
        return reply.notFound('Template not found');
      }
      return reply.send(template);
    },
  );

  // Create template
  app.post(
    '/api/quick-reply-templates',
    { onRequest: [app.authenticate, requirePermission('templates:create')] },
    async (request, reply) => {
      const parsed = createTemplateBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Only admin/manager can create global templates
      if (parsed.data.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const template = await createTemplate(
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
    '/api/quick-reply-templates/:id',
    { onRequest: [app.authenticate, requirePermission('templates:update')] },
    async (request, reply) => {
      const parsed = updateTemplateBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Only admin/manager can set global
      if (parsed.data.isGlobal && request.user.role === 'agent') {
        return reply.forbidden('Only admin or manager can create global templates');
      }

      const result = await updateTemplate(
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
        return reply.notFound('Template not found');
      }

      if ('forbidden' in result) {
        return reply.forbidden('You can only edit your own templates');
      }

      return reply.send(result);
    },
  );

  // Delete template
  app.delete<{ Params: { id: string } }>(
    '/api/quick-reply-templates/:id',
    { onRequest: [app.authenticate, requirePermission('templates:delete')] },
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
