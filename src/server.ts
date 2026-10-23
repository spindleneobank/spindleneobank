import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import { sql } from './db/client';
import { type Env, jsonError, notFound, requestId } from './lib/http';
import { logger } from './lib/logger';
import { routeModules } from './lib/modules';
import { closeQueues } from './lib/queue';
import { closeRedis } from './lib/redis';
import { websocket } from './lib/ws';
import { nodeHub } from './modules/nodes/hub';

export function buildApp(): Hono<Env> {
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
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['x-request-id'],
    }),
  );
  app.onError(jsonError);
  app.notFound(notFound);
  for (const mount of routeModules) mount(app);
  return app;
}

const app = buildApp();
const server = Bun.serve({ port: config.PORT, fetch: app.fetch, websocket });
logger.info({ port: server.port }, 'api listening');
void nodeHub.start().catch((err) => logger.error({ err }, 'node hub failed to start'));

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const force = setTimeout(() => {
    logger.error('shutdown deadline exceeded');
    process.exit(1);
  }, 15_000);
  try {
    await nodeHub.stop();
    await server.stop();
    await Promise.allSettled([sql.end(), closeRedis(), closeQueues()]);
  } finally {
    clearTimeout(force);
  }
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});
