import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { buyerBalances, buyers, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { PatchMeReq } from '../../shared/api/earnings';
import { dbRef, settings } from '../auth/constants';
import { requireSession } from '../auth/middleware';

async function loadMe(address: string) {
  const db = dbRef.db;
  const [user] = await db.select({ prefs: users.prefs }).from(users).where(eq(users.address, address));
  if (!user) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  const [buyer] = await db
    .select({ id: buyers.id, balance: buyerBalances.balanceUsdgMicros })
    .from(buyers)
    .leftJoin(buyerBalances, eq(buyerBalances.buyerId, buyers.id))
    .where(eq(buyers.address, address));
  return {
    address,
    prefs: user.prefs as Record<string, unknown>,
    isAdmin: settings.adminAddresses.map((a) => a.toLowerCase()).includes(address),
    buyer: buyer ? { id: buyer.id, balanceMicros: (buyer.balance ?? 0n).toString() } : null,
  };
}

export default function meRoutes(app: Hono<Env>): void {
  const addr = (c: { get: (k: 'user') => { address: string } | undefined }) => {
    const a = c.get('user')?.address;
    if (!a) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    return a.toLowerCase();
  };

  app.get('/v1/app/me', requireSession, async (c) => c.json(await loadMe(addr(c))));

  app.patch('/v1/app/me', requireSession, async (c) => {
    const address = addr(c);
    const body = await c.req.json().catch(() => undefined);
    const parsed = PatchMeReq.strict().safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION', 'Invalid preferences.', 400, parsed.error.issues);
    const patch = JSON.stringify(parsed.data.prefs);
    const [row] = await dbRef.db
      .update(users)
      .set({ prefs: sql`${users.prefs} || ${patch}::jsonb` })
      .where(eq(users.address, address))
      .returning({ prefs: users.prefs });
    if (!row) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    return c.json({ prefs: row.prefs });
  });
}
