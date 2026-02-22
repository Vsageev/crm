import type { FastifyInstance } from 'fastify';

/** Keys that could be used for prototype pollution attacks */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively sanitize all string values in an object:
 * - Strip HTML tags to prevent stored XSS
 * - Trim leading/trailing whitespace
 * - Remove null-byte characters
 * - Strip control characters (except tab, newline, carriage return)
 * - Block prototype pollution via dangerous keys
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\0/g, '') // Remove null bytes
      // eslint-disable-next-line no-control-regex
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Strip control chars (keep \t \n \r)
      .replace(/<[^>]*>/g, '') // Strip HTML tags
      .trim();
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value as Record<string, unknown>);
  }

  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    // Prototype pollution protection (OWASP Mass Assignment)
    if (DANGEROUS_KEYS.has(key)) continue;
    result[key] = sanitizeValue(obj[key]);
  }
  return result;
}

/**
 * Register a global `preHandler` hook that sanitizes request body, query, and params.
 */
export function registerSanitization(app: FastifyInstance) {
  app.addHook('preHandler', async (request) => {
    if (request.body && typeof request.body === 'object') {
      request.body = sanitizeObject(request.body as Record<string, unknown>);
    }

    if (request.query && typeof request.query === 'object') {
      request.query = sanitizeObject(request.query as Record<string, unknown>);
    }

    if (request.params && typeof request.params === 'object') {
      request.params = sanitizeObject(request.params as Record<string, unknown>);
    }
  });
}
