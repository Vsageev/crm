import fjwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { store } from '../db/index.js';

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

let devAuthWarningLogged = false;

export async function registerJwt(app: FastifyInstance) {
  await app.register(fjwt, {
    secret: env.JWT_SECRET,
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    if (env.DEV_SKIP_AUTH) {
      if (!devAuthWarningLogged) {
        request.log.warn('DEV_SKIP_AUTH is enabled — authentication is bypassed');
        devAuthWarningLogged = true;
      }

      const adminUser = store.findOne('users', (r) => r.role === 'admin' && r.isActive === true);
      request.user = adminUser
        ? { sub: adminUser.id as string, role: adminUser.role as string }
        : { sub: 'dev-user', role: 'admin' };
      return;
    }

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
