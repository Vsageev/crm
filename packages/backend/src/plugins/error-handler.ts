import type { FastifyInstance, FastifyError } from 'fastify';
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
