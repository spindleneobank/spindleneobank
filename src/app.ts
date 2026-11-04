import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { config } from './config';
import { type Env, jsonError, notFound, requestId } from './lib/http';
import { MAX_BODY_BYTES, MAX_REQUEST_BODY_BYTES, MAX_WS_PAYLOAD_BYTES } from './lib/limits';
import { websocket } from './lib/ws';

/** The app with its middleware. Modules are passed in because importing them has side effects (payment providers). */
export function buildApp(mounts: readonly ((app: Hono<Env>) => void)[]): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.use(
    '*',
    cors({
      origin: (origin) => (config.CORS_ORIGINS.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: [
        'content-type',
        'authorization',
        'x-spindle',
        'x-spindle-pay',
        'x-spindle-session',
        'x-payment',
        'x-spindle-lane',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: [
        'x-request-id',
        'X-Spindle-Job-Id',
        'X-Spindle-Receipt',
        'X-Spindle-Charge-Micros',
        'PAYMENT-REQUIRED',
        'X-PAYMENT-RESPONSE',
      ],
    }),
  );
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json(
          { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large (1 MiB limit).' } },
          413,
        ),
    }),
  );
  app.onError(jsonError);
  app.notFound(notFound);
  for (const mount of mounts) mount(app);
  return app;
}

/** Everything `Bun.serve` needs to run the app, limits included. */
export function serveOptions(app: Hono<Env>, port: number) {
  return {
    port,
    fetch: app.fetch,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    websocket: { ...websocket, maxPayloadLength: MAX_WS_PAYLOAD_BYTES },
  };
}
