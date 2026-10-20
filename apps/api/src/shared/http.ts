import { z } from 'zod';
import { ERROR_STATUS } from './errors.js';

/** Every error response has this shape. */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(
        Object.keys(ERROR_STATUS) as [keyof typeof ERROR_STATUS, ...Array<keyof typeof ERROR_STATUS>],
      ),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'Error' });

/** Standard error responses to attach to a route schema. */
export const errorResponses = <S extends number>(...statuses: S[]) =>
  Object.fromEntries(statuses.map((s) => [s, errorResponseSchema])) as Record<S, typeof errorResponseSchema>;

export const idParams = z.object({ id: z.string().min(1).max(64) });
