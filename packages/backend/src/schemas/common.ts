import { z } from 'zod/v4';

export const idParamSchema = z.object({
  id: z.uuid(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Deterministic error response schema – every field is always present.
 * `details` and `hint` are null when not applicable (never omitted).
 */
export const errorResponseSchema = z.object({
  statusCode: z.number(),
  code: z.string(),
  error: z.string(),
  message: z.string(),
  details: z
    .array(
      z.object({
        field: z.string().nullable(),
        code: z.string(),
        message: z.string(),
        expected: z.unknown().nullable(),
      }),
    )
    .nullable(),
  hint: z.string().nullable(),
});
