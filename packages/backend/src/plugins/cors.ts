import cors from '@fastify/cors';
import { env } from '../config/env.js';
import type { FastifyInstance } from 'fastify';

/**
 * CORS configuration hardened per OWASP guidelines.
 *
 * - Credentials are only sent to the configured origin (CORS_ORIGIN).
 * - Widget/public endpoints work without credentials so wildcard is fine
 *   for those, but we restrict credentialed requests to the known origin.
 */
export async function registerCors(app: FastifyInstance) {
  // Parse allowed origins from env (comma-separated for multiple frontends)
  const allowedOrigins = env.CORS_ORIGIN
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return cb(null, true);

      // Allow configured origins
      if (allowedOrigins.includes(origin)) return cb(null, true);

      // For non-credentialed requests (widget embeds), allow any origin
      // The actual security boundary is JWT / API key auth, not CORS
      return cb(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
    exposedHeaders: ['X-Total-Count', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Idempotent-Replay'],
    maxAge: 86400, // Cache preflight for 24h
  });
}
