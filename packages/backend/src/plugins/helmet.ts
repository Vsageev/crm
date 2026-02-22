import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

export async function registerHelmet(app: FastifyInstance) {
  await app.register(helmet, {
    contentSecurityPolicy: false, // Disabled — CSP is best handled by the frontend reverse proxy
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow widget/media embedding
  });
}
