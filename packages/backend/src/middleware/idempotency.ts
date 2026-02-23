import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  createdAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const cache = new Map<string, CachedResponse>();

function cleanup() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.createdAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

// Run cleanup every hour
const cleanupInterval = setInterval(cleanup, 60 * 60 * 1000);
cleanupInterval.unref();

export function registerIdempotency(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'POST') return;

    const key = request.headers['idempotency-key'] as string | undefined;
    if (!key) return;

    const cached = cache.get(key);
    if (!cached) return;

    if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
      cache.delete(key);
      return;
    }

    for (const [h, v] of Object.entries(cached.headers)) {
      reply.header(h, v);
    }
    reply.header('x-idempotent-replay', 'true');
    reply.status(cached.statusCode).send(cached.body);
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (request.method !== 'POST') return payload;

    const key = request.headers['idempotency-key'] as string | undefined;
    if (!key) return payload;

    // Don't cache error responses (5xx)
    if (reply.statusCode >= 500) return payload;

    if (!cache.has(key)) {
      const contentType = reply.getHeader('content-type') as string | undefined;
      cache.set(key, {
        statusCode: reply.statusCode,
        headers: contentType ? { 'content-type': contentType } : {},
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
        createdAt: Date.now(),
      });
    }

    return payload;
  });
}
