import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listKBEntries,
  getKBEntryById,
  createKBEntry,
  updateKBEntry,
  deleteKBEntry,
} from '../services/knowledge-base.js';

const createKBBody = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
});

const updateKBBody = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
});

const listKBQuery = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function knowledgeBaseRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List entries
  typedApp.get(
    '/api/knowledge-base',
    { onRequest: [app.authenticate, requirePermission('knowledge-base:read')], schema: { tags: ['Knowledge Base'], summary: 'List knowledge base entries', querystring: listKBQuery } },
    async (request, reply) => {
      const { entries, total } = await listKBEntries({
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

  // Get single entry
  typedApp.get(
    '/api/knowledge-base/:id',
    { onRequest: [app.authenticate, requirePermission('knowledge-base:read')], schema: { tags: ['Knowledge Base'], summary: 'Get single knowledge base entry', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const entry = await getKBEntryById(request.params.id);
      if (!entry) {
        return reply.notFound('Knowledge base entry not found');
      }
      return reply.send(entry);
    },
  );

  // Create entry
  typedApp.post(
    '/api/knowledge-base',
    { onRequest: [app.authenticate, requirePermission('knowledge-base:create')], schema: { tags: ['Knowledge Base'], summary: 'Create knowledge base entry', body: createKBBody } },
    async (request, reply) => {
      const entry = await createKBEntry(
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

      return reply.status(201).send(entry);
    },
  );

  // Update entry
  typedApp.patch(
    '/api/knowledge-base/:id',
    { onRequest: [app.authenticate, requirePermission('knowledge-base:update')], schema: { tags: ['Knowledge Base'], summary: 'Update knowledge base entry', params: z.object({ id: z.uuid() }), body: updateKBBody } },
    async (request, reply) => {
      const result = await updateKBEntry(
        request.params.id,
        request.body,
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      if (!result) {
        return reply.notFound('Knowledge base entry not found');
      }

      return reply.send(result);
    },
  );

  // Delete entry
  typedApp.delete(
    '/api/knowledge-base/:id',
    { onRequest: [app.authenticate, requirePermission('knowledge-base:delete')], schema: { tags: ['Knowledge Base'], summary: 'Delete knowledge base entry', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const result = await deleteKBEntry(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result) {
        return reply.notFound('Knowledge base entry not found');
      }

      return reply.status(204).send();
    },
  );
}
