import { randomUUID } from 'node:crypto';
import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AppError, type ErrorCode, toHttp } from './errors';
import { logger } from './logger';

export type SessionInfo = { address: string; freshUntil: number };

export type Env = {
  Variables: {
    user?: { address: string };
    session?: SessionInfo;
    requestId: string;
  };
};

export const requestId: MiddlewareHandler<Env> = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
};

/** App-level onError: renders the dashboard `{ error: { code, message, details } }` shape. */
export const jsonError: ErrorHandler<Env> = (err, c) => {
  let mapped = toHttp(err);
  if (err instanceof HTTPException) {
    const code: ErrorCode =
      err.status === 401 ? 'UNAUTHENTICATED' : err.status === 404 ? 'NOT_FOUND' : 'VALIDATION';
    mapped = toHttp(err.status < 500 ? new AppError(code, err.message, err.status) : err);
  }
  if (mapped.status >= 500) {
    logger.error({ err, requestId: c.get('requestId') }, 'unhandled request error');
  }
  return c.json(mapped.body, mapped.status as 400);
};

export const notFound = (c: Context<Env>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

/** OpenAI-compatible error shape: `{ error: { message, type, code } }`. */
export function openaiError(c: Context, err: unknown) {
  const { status, body } = toHttp(err);
  const type = status >= 500 ? 'server_error' : status === 429 ? 'rate_limit_error' : 'invalid_request_error';
  const d = body.error.details as { openaiCode?: string } | undefined;
  return c.json(
    { error: { message: body.error.message, type, code: d?.openaiCode ?? body.error.code } },
    status as 400,
  );
}
