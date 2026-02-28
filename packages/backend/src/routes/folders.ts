import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { ApiError } from '../utils/api-errors.js';
import {
  listFolders,
  getFolderById,
  isGeneralFolder,
  createFolder,
  updateFolder,
  deleteFolder,
} from '../services/folders.js';
import { listCards } from '../services/cards.js';

const createFolderBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
});

const updateFolderBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
});

export async function folderRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List folders
  typedApp.get(
    '/api/folders',
    {
      onRequest: [app.authenticate, requirePermission('folders:read')],
      schema: {
        tags: ['Folders'],
        summary: 'List folders',
        querystring: z.object({
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listFolders({
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

  // Get single folder
  typedApp.get(
    '/api/folders/:id',
    {
      onRequest: [app.authenticate, requirePermission('folders:read')],
      schema: {
        tags: ['Folders'],
        summary: 'Get a single folder by ID',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const folder = await getFolderById(request.params.id);
      if (!folder) {
        return reply.notFound('Folder not found');
      }
      return reply.send(folder);
    },
  );

  // Get cards in folder
  typedApp.get(
    '/api/folders/:id/cards',
    {
      onRequest: [app.authenticate, requirePermission('cards:read')],
      schema: {
        tags: ['Folders'],
        summary: 'List cards in a folder',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const folder = await getFolderById(request.params.id);
      if (!folder) {
        return reply.notFound('Folder not found');
      }

      const { entries, total } = await listCards({
        folderId: request.params.id,
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

  // Create folder
  typedApp.post(
    '/api/folders',
    {
      onRequest: [app.authenticate, requirePermission('folders:create')],
      schema: {
        tags: ['Folders'],
        summary: 'Create a new folder',
        body: createFolderBody,
      },
    },
    async (request, reply) => {
      const folder = await createFolder(request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(folder);
    },
  );

  // Update folder
  typedApp.patch(
    '/api/folders/:id',
    {
      onRequest: [app.authenticate, requirePermission('folders:update')],
      schema: {
        tags: ['Folders'],
        summary: 'Update an existing folder',
        params: z.object({ id: z.uuid() }),
        body: updateFolderBody,
      },
    },
    async (request, reply) => {
      const updated = await updateFolder(request.params.id, request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Folder not found');
      }

      return reply.send(updated);
    },
  );

  // Delete folder
  typedApp.delete(
    '/api/folders/:id',
    {
      onRequest: [app.authenticate, requirePermission('folders:delete')],
      schema: {
        tags: ['Folders'],
        summary: 'Delete a folder',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const folder = await getFolderById(request.params.id);
      if (!folder) {
        return reply.notFound('Folder not found');
      }

      if (isGeneralFolder(folder)) {
        throw ApiError.conflict(
          'general_collection_protected',
          'General collections cannot be deleted',
          'Create and use another collection if you need to remove this one',
        );
      }

      const deleted = await deleteFolder(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Folder not found');
      }

      return reply.status(204).send();
    },
  );
}
