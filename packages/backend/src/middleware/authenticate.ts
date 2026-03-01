import type { FastifyReply, FastifyRequest } from 'fastify';

export interface JwtPayload {
  sub: string; // user id
  iat?: number;
  exp?: number;
}

/**
 * Fastify preHandler that verifies the JWT from the Authorization header
 * and attaches the decoded payload to `request.user`.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
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
