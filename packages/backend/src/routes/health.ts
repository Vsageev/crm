import type { FastifyInstance } from 'fastify';
import { store } from '../db/index.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    try {
      // Simple check: try to read from the store
      store.getAll('users');
      return reply.send({ status: 'ok', db: 'connected' });
    } catch {
      return reply.status(503).send({ status: 'error', db: 'disconnected' });
    }
  });
}
