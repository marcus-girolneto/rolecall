/** Stable machine-readable error codes. Each maps to exactly one HTTP status. */
export const ERROR_STATUS = {
  bad_request: 400,
  validation_error: 400,
  invalid_signature: 400,
  unauthorized: 401,
  plan_limit_reached: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  invalid_bundle: 422,
  rate_limited: 429,
  internal: 500,
  billing_disabled: 501,
  unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** The only error type services throw on purpose. The error handler renders it as `{ error: { code, message, details? } }`. */
export class AppError extends Error {
  override name = 'AppError';
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = ERROR_STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} not found`);
export const forbidden = (message = 'This API key is not allowed to perform this action') =>
  new AppError('forbidden', message);
export const unauthorized = (message = 'Missing or invalid API key') => new AppError('unauthorized', message);
