import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import claimsRoutes from '../claims/routes';
import { epochTreePath, latestEpochView } from './service';

/** Mounts the public epoch routes and the claims routes (`/v1/app/claim/proof`, `/v1/app/claims`). */
export default function epochRoutes(app: Hono<Env>): void {
  claimsRoutes(app);

  app.get('/v1/epochs/latest', async (c) => {
    c.header('cache-control', 'public, max-age=30');
    return c.json(await latestEpochView());
  });

  app.get('/v1/epochs/:epoch/tree', async (c) => {
    const raw = c.req.param('epoch');
    if (!/^\d{1,18}$/.test(raw)) throw new AppError('VALIDATION', 'Invalid epoch.', 400);
    const path = await epochTreePath(BigInt(raw));
    // Files are written tmp+rename, so an open handle always sees a complete tree.
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });
}
