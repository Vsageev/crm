import type { FastifyInstance, FastifyError } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { env } from '../config/env.js';

/**
 * Global error handler that prevents information leakage (OWASP A01/A05).
 *
 * - In production: returns generic messages for 5xx errors
 * - Always: logs the full error internally for debugging
 * - Ensures stack traces and internal details never reach the client
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Handle Zod schema validation errors from fastify-type-provider-zod
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation
        .map((v) => {
          const path = v.params?.issue?.path?.join('.') ?? '';
          const msg = v.params?.issue?.message ?? v.message ?? 'Invalid';
          return path ? `${path}: ${msg}` : msg;
        })
        .join('; ');

      request.log.warn(
        { err: error, url: request.url, method: request.method },
        'Validation error',
      );

      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: details,
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

    // For 4xx errors, return the message (these are intentional user-facing errors)
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        statusCode,
        error: error.name || 'Error',
        message: error.message,
      });
    }

    // For 5xx in production, hide internal details
    if (env.NODE_ENV === 'production') {
      return reply.status(statusCode).send({
        statusCode,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    }

    // In development, include the error message (but never the stack)
    return reply.status(statusCode).send({
      statusCode,
      error: error.name || 'Internal Server Error',
      message: error.message,
    });
  });
}
