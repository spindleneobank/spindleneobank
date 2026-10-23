import type { Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { GetAppReceiptsReq } from '../../shared/api/earnings';
import { requireSession } from '../auth/middleware';
import earningsRoutes from '../earnings/routes';
import { utcDay } from '../gateway/pricing';
import { ensureRateCard, rateCardFor } from '../rates/service';
import { appReceipt, listAppReceipts, publicReceipt, registerReceiptHandler } from './service';

/**
 * Mounts the receipt, rate-card and earnings routes and registers the verifier with the gateway
 * (`registerJobFinishedHandler`). The gateway runs in the API process, so this is where it belongs.
 */
export default function receiptRoutes(app: Hono<Env>): void {
  registerReceiptHandler();
  earningsRoutes(app);

  app.get('/v1/receipts/:jobId', async (c) => {
    c.header('cache-control', 'public, max-age=60');
    return c.json(await publicReceipt(c.req.param('jobId')));
  });

  app.get('/v1/rate-card', async (c) => {
    const day = utcDay();
    let rows = await rateCardFor(day);
    if (rows.length === 0) {
      await ensureRateCard(day); // insert-only: first boot
      rows = await rateCardFor(day);
    }
    return c.json(
      rows.map((r) => ({
        gpuClass: r.gpuClass,
        lane: r.lane,
        unitKind: r.unitKind,
        providerMicrosPerUnit: r.providerMicrosPerUnit.toString(),
        buyerMicrosPerUnit: r.buyerMicrosPerUnit.toString(),
      })),
    );
  });

  const me = (address: string | undefined) => {
    if (!address) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    return address;
  };

  app.get('/v1/app/receipts', requireSession, async (c) => {
    const parsed = GetAppReceiptsReq.safeParse(c.req.query());
    if (!parsed.success) throw new AppError('VALIDATION', 'Invalid query.', 400, parsed.error.issues);
    return c.json(await listAppReceipts(me(c.get('user')?.address), parsed.data));
  });

  app.get('/v1/app/receipts/:jobId', requireSession, async (c) =>
    c.json(await appReceipt(me(c.get('user')?.address), c.req.param('jobId'))),
  );
}
