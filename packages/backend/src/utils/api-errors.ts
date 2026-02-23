/**
 * Structured API errors for agent-friendly "Graceful Failure" responses.
 *
 * Every error includes a machine-readable `code` that consumers (including
 * LLM agents) can parse and react to without relying on human-readable
 * messages. Where useful, `hint` provides a short corrective suggestion.
 */

export interface ApiErrorOptions {
  /** Machine-readable error code, e.g. "duplicate_email" */
  code: string;
  /** HTTP status code */
  statusCode: number;
  /** Human-readable message */
  message: string;
  /** Corrective hint for API consumers */
  hint?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly hint?: string;

  constructor(opts: ApiErrorOptions) {
    super(opts.message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.hint = opts.hint;
  }

  /* ── Convenience factories ─────────────────────────────────────── */

  static badRequest(code: string, message: string, hint?: string) {
    return new ApiError({ code, statusCode: 400, message, hint });
  }

  static unauthorized(code: string, message: string, hint?: string) {
    return new ApiError({ code, statusCode: 401, message, hint });
  }

  static forbidden(code: string, message: string, hint?: string) {
    return new ApiError({ code, statusCode: 403, message, hint });
  }

  static notFound(code: string, message: string, hint?: string) {
    return new ApiError({ code, statusCode: 404, message, hint });
  }

  static conflict(code: string, message: string, hint?: string) {
    return new ApiError({ code, statusCode: 409, message, hint });
  }

  static tooMany(code: string, message: string, hint?: string) {
    return new ApiError({ code, statusCode: 429, message, hint });
  }
}
