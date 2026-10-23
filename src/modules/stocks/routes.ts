import { PostStocksQuoteReq } from '@spindle/shared/api/stocks';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { chainQuoteDeps, quote } from './quote';
import { getStock, listAll, listEnabled, upsertVerified } from './service';

export type StockAuth = {
  /** Session required; also enforces CSRF on unsafe methods. */
  session: MiddlewareHandler<Env>;
  admin: MiddlewareHandler<Env>;
};

/** Fail-closed placeholder until the auth module is wired in (see lib/modules.ts). */
const denied: MiddlewareHandler<Env> = async () => {
  throw new AppError('UNAUTHENTICATED', 'authentication not configured');
};

const sessionAddress = (c: Context<Env>): string => {
  const addr = c.get('user')?.address ?? c.get('session')?.address;
  if (!addr) throw new AppError('UNAUTHENTICATED', 'sign in required');
  return addr;
};

const PutBody = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  enabled: z.boolean().default(true),
});

export function stockRoutes(auth: StockAuth) {
  return (app: Hono<Env>) => {
    app.get('/v1/app/stocks', auth.session, async (c) => c.json(await listEnabled()));

    app.post('/v1/app/stocks/quote', auth.session, async (c) => {
      const parsed = PostStocksQuoteReq.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        throw new AppError('VALIDATION', 'invalid quote request', 400, parsed.error.flatten());
      const out = await quote(chainQuoteDeps(getStock), {
        token: parsed.data.token,
        amountInMicros: parsed.data.amountInMicros,
        slippageBps: parsed.data.slippageBps,
        user: sessionAddress(c),
      });
      return c.json(out);
    });

    app.get('/v1/admin/stock-tokens', auth.admin, async (c) => c.json(await listAll()));

    app.put('/v1/admin/stock-tokens', auth.admin, async (c) => {
      const parsed = PutBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION', 'invalid body', 400, parsed.error.flatten());
      const result = await upsertVerified(parsed.data.address, parsed.data.enabled);
      if (!result.ok) throw new AppError('VALIDATION', `verification failed: ${result.reason}`);
      return c.json(result);
    });
  };
}

export default stockRoutes({ session: denied, admin: denied });
