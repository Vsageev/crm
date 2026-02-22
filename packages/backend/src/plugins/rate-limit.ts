import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW_MS,
    allowList: [],
    keyGenerator: (request) => {
      // Use authenticated user id when available, otherwise fall back to IP
      return request.user?.sub ?? request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil((context.ttl ?? 0) / 1000)} seconds.`,
      retryAfter: Math.ceil((context.ttl ?? 0) / 1000),
    }),
  });
}

/**
 * Route-level rate limit config for auth endpoints (login, register, 2FA).
 * Apply via `{ config: { rateLimit: authRateLimitConfig() } }` on route options.
 */
export function authRateLimitConfig() {
  return {
    max: env.RATE_LIMIT_AUTH_MAX,
    timeWindow: env.RATE_LIMIT_AUTH_WINDOW_MS,
    keyGenerator: (request: { ip: string }) => request.ip,
  };
}

/**
 * Route-level rate limit config for public API endpoints.
 * Apply via `{ config: { rateLimit: apiRateLimitConfig() } }` on route options.
 */
export function apiRateLimitConfig() {
  return {
    max: env.RATE_LIMIT_API_MAX,
    timeWindow: env.RATE_LIMIT_API_WINDOW_MS,
  };
}
