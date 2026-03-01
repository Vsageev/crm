import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { store } from '../db/index.js';

export async function userRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/api/users',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'List workspace users',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
          includeAgents: z.coerce.boolean().default(false),
        }),
      },
    },
    async (request, reply) => {
      const all = (store.getAll('users') as any[]).filter(
        (u: any) => u.isActive !== false && (request.query.includeAgents || u.type !== 'agent'),
      );
      const { limit, offset } = request.query;
      const entries = all.slice(offset, offset + limit).map((u: any) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        type: u.type ?? 'human',
      }));
      return reply.send({ total: all.length, limit, offset, entries });
    },
  );
}
