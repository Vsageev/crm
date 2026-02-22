import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { store } from '../db/index.js';
import { requirePermission } from '../middleware/rbac.js';

const createTagBody = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

const updateTagBody = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export async function tagRoutes(app: FastifyInstance) {
  // List all tags
  app.get(
    '/api/tags',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (_request, reply) => {
      const entries = store.getAll('tags');
      // Sort by createdAt descending
      entries.sort((a, b) => {
        const aDate = a.createdAt as string || '';
        const bDate = b.createdAt as string || '';
        return bDate.localeCompare(aDate);
      });
      return reply.send({ entries });
    },
  );

  // Create tag
  app.post(
    '/api/tags',
    { onRequest: [app.authenticate, requirePermission('contacts:create')] },
    async (request, reply) => {
      const parsed = createTagBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const existing = store.findOne('tags', (t) => t.name === parsed.data.name);

      if (existing) {
        return reply.conflict('Tag with this name already exists');
      }

      const tag = store.insert('tags', parsed.data);
      return reply.status(201).send(tag);
    },
  );

  // Update tag
  app.patch<{ Params: { id: string } }>(
    '/api/tags/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:update')] },
    async (request, reply) => {
      const parsed = updateTagBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      if (parsed.data.name) {
        const existing = store.findOne('tags', (t) => t.name === parsed.data.name);

        if (existing && existing.id !== request.params.id) {
          return reply.conflict('Tag with this name already exists');
        }
      }

      const updated = store.update('tags', request.params.id, parsed.data);

      if (!updated) {
        return reply.notFound('Tag not found');
      }

      return reply.send(updated);
    },
  );

  // Delete tag
  app.delete<{ Params: { id: string } }>(
    '/api/tags/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:delete')] },
    async (request, reply) => {
      const deleted = store.delete('tags', request.params.id);

      if (!deleted) {
        return reply.notFound('Tag not found');
      }

      return reply.status(204).send();
    },
  );
}
