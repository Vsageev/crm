import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string; twoFactor?: boolean };
    user: { sub: string; role: string; twoFactor?: boolean };
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
    try {
      await request.jwtVerify();

      // Reject 2FA temporary tokens from being used as regular auth
      if (request.user.twoFactor) {
        return reply.unauthorized('Two-factor verification required');
      }
    } catch {
      return reply.unauthorized('Invalid or expired token');
    }
  });
}
