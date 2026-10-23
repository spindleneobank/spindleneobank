export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'REAUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYMENT_REQUIRED'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_CAPACITY'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INSUFFICIENT_LIQUIDITY'
  | 'CHAIN_STATE'
  | 'INTERNAL';

export const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  REAUTH_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYMENT_REQUIRED: 402,
  INSUFFICIENT_BALANCE: 402,
  NO_CAPACITY: 503,
  UPSTREAM_UNAVAILABLE: 502,
  INSUFFICIENT_LIQUIDITY: 409,
  CHAIN_STATE: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = DEFAULT_STATUS[code],
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type HttpError = {
  status: number;
  body: { error: { code: ErrorCode; message: string; details?: unknown } };
};

/** Maps any thrown value to an HTTP error body. 500s never leak the internal message. */
export function toHttp(err: unknown): HttpError {
  if (err instanceof AppError && err.status < 500) {
    const error: HttpError['body']['error'] = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return { status: err.status, body: { error } };
  }
  if (err instanceof AppError) {
    // 5xx AppErrors (e.g. NO_CAPACITY, UPSTREAM_UNAVAILABLE) have deliberate public messages.
    if (err.code !== 'INTERNAL') {
      return { status: err.status, body: { error: { code: err.code, message: err.message } } };
    }
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Internal server error' } } };
}
