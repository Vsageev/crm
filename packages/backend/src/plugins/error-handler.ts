import type { FastifyInstance, FastifyError } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ApiError } from '../utils/api-errors.js';
import { env } from '../config/env.js';

/**
 * Global error handler – "Graceful Failure" design.
 *
 * Every error response contains:
 *   - `statusCode`  – HTTP status
 *   - `code`        – machine-readable error identifier (e.g. "validation_error")
 *   - `error`       – short human-readable label
 *   - `message`     – descriptive human-readable text
 *   - `hint`        – (optional) corrective suggestion for API consumers / agents
 *   - `details`     – (optional) per-field breakdown for validation errors
 *
 * Null / optional fields that are absent are still included as `null`
 * (deterministic structure).
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // ── Zod schema validation errors ────────────────────────────────
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((v) => {
        const path = v.params?.issue?.path?.join('.') ?? '';
        const msg = v.params?.issue?.message ?? v.message ?? 'Invalid';
        const zodCode = v.params?.issue?.code as string | undefined;
        const expected = v.params?.issue?.expected as unknown;

        return {
          field: path || null,
          code: zodCode ?? 'invalid_value',
          message: msg,
          expected: expected ?? null,
        };
      });

      request.log.warn(
        { err: error, url: request.url, method: request.method },
        'Validation error',
      );

      return reply.status(400).send({
        statusCode: 400,
        code: 'validation_error',
        error: 'Bad Request',
        message: details
          .map((d) => (d.field ? `${d.field}: ${d.message}` : d.message))
          .join('; '),
        details,
        hint: null,
      });
    }

    // ── ApiError (thrown by route handlers) ──────────────────────────
    if (error instanceof ApiError) {
      request.log.warn(
        {
          err: error,
          statusCode: error.statusCode,
          code: error.code,
          url: request.url,
          method: request.method,
          userId: request.user?.sub,
        },
        'API error',
      );

      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        code: error.code,
        error: error.name,
        message: error.message,
        details: null,
        hint: error.hint ?? null,
      });
    }

    const statusCode = error.statusCode ?? 500;

    // Log the full error for debugging
    request.log.error(
      {
        err: error,
        statusCode,
        url: request.url,
        method: request.method,
        userId: request.user?.sub,
      },
      'Request error',
    );

    // ── 4xx client errors (from reply.notFound, reply.badRequest, etc.) ─
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        statusCode,
        code: toSnakeCase(error.name || 'client_error'),
        error: error.name || 'Error',
        message: error.message,
        details: null,
        hint: null,
      });
    }

    // ── 5xx server errors ───────────────────────────────────────────
    if (env.NODE_ENV === 'production') {
      return reply.status(statusCode).send({
        statusCode,
        code: 'internal_error',
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        details: null,
        hint: null,
      });
    }

    // Development – include message but never the stack
    return reply.status(statusCode).send({
      statusCode,
      code: 'internal_error',
      error: error.name || 'Internal Server Error',
      message: error.message,
      details: null,
      hint: null,
    });
  });
}

/**
 * Converts PascalCase / camelCase error names to snake_case codes.
 * e.g. "NotFoundError" → "not_found_error"
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_')
    .toLowerCase();
}
