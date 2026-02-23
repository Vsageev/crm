import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { store } from '../db/index.js';

export async function healthRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get('/health', { schema: { tags: ['Health'], summary: 'Health check' } }, async (_req, reply) => {
    try {
      // Simple check: try to read from the store
      store.getAll('users');
      return reply.send({ status: 'ok', db: 'connected' });
    } catch {
      return reply.status(503).send({ status: 'error', db: 'disconnected' });
    }
  });
}
