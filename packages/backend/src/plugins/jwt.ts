import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { authenticateApiKeyOrJwt } from '../middleware/api-key-auth.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; twoFactor?: boolean };
    user: { sub: string; twoFactor?: boolean };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerJwt(app: FastifyInstance) {
  await app.register(fjwt, {
    secret: env.JWT_SECRET,
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    return authenticateApiKeyOrJwt(request, reply);
  });
}
