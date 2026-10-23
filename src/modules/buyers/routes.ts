import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { buyerBalances } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { GetBuyerDepositCallReq, GetBuyerLedgerReq, GetBuyerUsageReq } from '../../shared/api/buyer';
import { dbRef } from '../auth/constants';
import { requireSession } from '../auth/middleware';
import { x402Status } from '../x402/guard';
import { apiKeyRoutes } from './apikeys';
import {
  buyerIdForAddress,
  type DepositDeps,
  defaultDepositDeps,
  depositCall,
  listLedger,
  usage,
} from './service';

export const createBuyerRoutes =
  (deps: DepositDeps = defaultDepositDeps) =>
  (app: Hono<Env>): void => {
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

    const addr = (c: { get(k: 'user'): { address?: string } | undefined }) =>
      (c.get('user')?.address ?? '').toLowerCase();
    const parse = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, v: unknown) => {
      const p = schema.safeParse(v);
      if (!p.success) throw new AppError('VALIDATION', 'Invalid query.');
      return p.data as T;
    };

    app.get('/v1/app/buyer/ledger', requireSession, async (c) =>
      c.json(await listLedger(addr(c), parse(GetBuyerLedgerReq, c.req.query()))),
    );
    app.get('/v1/app/buyer/usage', requireSession, async (c) =>
      c.json(await usage(addr(c), parse(GetBuyerUsageReq, c.req.query()).range)),
    );
    app.get('/v1/app/buyer/deposit-call', requireSession, async (c) => {
      const { amountMicros } = parse(GetBuyerDepositCallReq, c.req.query());
      return c.json(await depositCall(addr(c), BigInt(amountMicros), deps));
    });
  };

export default createBuyerRoutes();
