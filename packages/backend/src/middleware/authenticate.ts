import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from 'shared';
import { env } from '../config/env.js';
import { store } from '../db/index.js';

export interface JwtPayload {
  sub: string; // user id
  role: UserRole;
  iat?: number;
  exp?: number;
}

let devAuthWarningLogged = false;

/**
 * Fastify preHandler that verifies the JWT from the Authorization header
 * and attaches the decoded payload to `request.user`.
 *
 * When DEV_SKIP_AUTH=true, JWT verification is skipped entirely and a
 * mock admin user is injected into the request.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (env.DEV_SKIP_AUTH) {
    if (!devAuthWarningLogged) {
      request.log.warn('DEV_SKIP_AUTH is enabled — authentication is bypassed. Do NOT use in production!');
      devAuthWarningLogged = true;
    }

    const adminUser = store.findOne('users', (r) => r.role === 'admin' && r.isActive === true);

    request.user = adminUser
      ? { sub: adminUser.id as string, role: adminUser.role as string }
      : { sub: 'dev-user', role: 'admin' };

    return;
  }

  try {
    const payload = await request.jwtVerify<JwtPayload & { twoFactor?: boolean }>();

    // Reject 2FA temporary tokens from being used as regular auth
    if (payload.twoFactor) {
      return reply.unauthorized('Two-factor verification required');
    }

    request.user = payload;
  } catch {
    return reply.unauthorized('Invalid or missing authentication token');
  }
}
