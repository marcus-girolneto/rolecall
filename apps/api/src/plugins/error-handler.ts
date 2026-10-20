import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError, ERROR_STATUS, type ErrorCode } from '../shared/errors.js';

const BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
  503: 'unavailable',
};

const body = (code: ErrorCode, message: string, details?: unknown) => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

/** Renders every failure as `{ error: { code, message, details? } }`. Never exposes stack traces or internals. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) request.log.error({ err }, err.message);
      return reply.code(err.status).send(body(err.code, err.message, err.details));
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({ path: v.instancePath || '/', message: v.message }));
      return reply
        .code(400)
        .send(body('validation_error', `Invalid request ${err.validationContext ?? ''}`.trim(), { issues }));
    }
    if (isResponseSerializationError(err)) {
      request.log.error({ err, issues: err.cause.issues }, 'response did not match its schema');
      return reply.code(500).send(body('internal', 'Internal server error'));
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 400 && status < 500) {
      const code = BY_STATUS[status] ?? 'bad_request';
      return reply.code(status).send(body(code, err.message));
    }
    request.log.error({ err }, 'unhandled error');
    return reply.code(500).send(body('internal', 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(body('not_found', `Route ${request.method} ${request.url.split('?')[0]} not found`));
  });
}

export { ERROR_STATUS };
