import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { buyerBalances } from '../../db/schema';
import type { Env } from '../../lib/http';
import { dbRef } from '../auth/constants';
import { requireSession } from '../auth/middleware';
import { x402Status } from '../x402/guard';
import { apiKeyRoutes } from './apikeys';
import { buyerIdForAddress } from './service';

export default function buyerRoutes(app: Hono<Env>): void {
  apiKeyRoutes(app);

  app.get('/v1/app/buyer', requireSession, async (c) => {
    const address = (c.get('user')?.address ?? '').toLowerCase();
    const buyerId = await buyerIdForAddress(address);
    const [bal] = await dbRef.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, buyerId));
    return c.json({
      address,
      balanceMicros: (bal?.balanceUsdgMicros ?? 0n).toString(),
      reservedMicros: (bal?.reservedUsdgMicros ?? 0n).toString(),
      x402: await x402Status(),
    });
  });
}
