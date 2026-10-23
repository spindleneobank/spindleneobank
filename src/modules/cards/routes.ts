import type { Context, Hono } from 'hono';
import { type ZodType, z } from 'zod';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { clientIp, hashIp, rateLimit } from '../../lib/ratelimit';
import {
  PostCardsReq as BaseCardsReq,
  PostCardTopupsReq,
  PostRelayOrderSubmittedReq,
} from '../../shared/api/cards';
import { PageQuery } from '../../shared/api/common';
import { requireFreshAuth, requireSession } from '../auth/middleware';
import { createRelayQuote, markSubmitted } from '../relay/orders';
import { armApplePay, getApplePay } from './applePay';
import {
  createCard,
  createTopup,
  getOperation,
  getPricingView,
  getTransactions,
  ISSUABLE_PRODUCTS,
  listCards,
  revealCard,
  userIdFor,
} from './service';
import { assertProductionSafe } from './settings';

// Stricter than the shared schema: issuable products only, bounded email/alias/finish.
const PostCardsReq = BaseCardsReq.extend({
  product: z.enum(ISSUABLE_PRODUCTS),
  email: z.string().trim().max(254).email(),
  alias: z
    .string()
    .trim()
    .max(64)
    .refine(
      (v) => ![...v].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127),
      'no control characters',
    )
    .optional(),
  finish: z
    .string()
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

async function body<T extends ZodType>(
  c: { req: { json: () => Promise<unknown> } },
  schema: T,
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid request body.', 400, parsed.error.issues);
  return parsed.data;
}

const byUser = (c: Context<Env>) => c.get('user')?.address ?? '';
const sensitiveLimit = rateLimit({ name: 'cards_sensitive', key: byUser, points: 10, windowSec: 600 });
const writeLimit = rateLimit({ name: 'cards_write', key: byUser, points: 20, windowSec: 600 });

export default function cardRoutes(app: Hono<Env>): void {
  assertProductionSafe();
  const me = async (c: Context<Env>) => {
    const address = byUser(c);
    return { address, userId: await userIdFor(address), ipHash: hashIp(clientIp(c)) };
  };

  app.get('/v1/app/cards/pricing', requireSession, async (c) => c.json(await getPricingView()));

  app.get('/v1/app/cards', requireSession, async (c) => c.json(await listCards((await me(c)).userId)));

  app.post('/v1/app/cards', requireSession, writeLimit, async (c) => {
    const input = await body(c, PostCardsReq);
    return c.json(await createCard(await me(c), input));
  });

  app.post('/v1/app/cards/:id/topups', requireSession, writeLimit, async (c) => {
    const { amountUsdCents } = await body(c, PostCardTopupsReq);
    return c.json(await createTopup(await me(c), c.req.param('id'), BigInt(amountUsdCents)));
  });

  app.get('/v1/app/card-operations/:id', requireSession, async (c) =>
    c.json(await getOperation((await me(c)).userId, c.req.param('id'))),
  );

  app.post('/v1/app/card-operations/:id/relay-quote', requireSession, writeLimit, async (c) => {
    const { address, userId } = await me(c);
    return c.json(await createRelayQuote(userId, address, c.req.param('id')));
  });

  app.post('/v1/app/relay-orders/:id/submitted', requireSession, writeLimit, async (c) => {
    const { step, txHash } = await body(c, PostRelayOrderSubmittedReq);
    const { address, userId } = await me(c);
    return c.json(await markSubmitted(userId, address, c.req.param('id'), step, txHash));
  });

  app.get('/v1/app/cards/:id/transactions', requireSession, async (c) => {
    const q = PageQuery.safeParse(c.req.query());
    if (!q.success) throw new AppError('VALIDATION', 'Invalid query.', 400, q.error.issues);
    return c.json(
      await getTransactions((await me(c)).userId, c.req.param('id'), q.data.limit, q.data.cursor),
    );
  });

  // Sensitive: fresh wallet signature, never cached, never logged.
  app.post('/v1/app/cards/:id/reveal', requireSession, requireFreshAuth, sensitiveLimit, async (c) => {
    const details = await revealCard((await me(c)).userId, c.req.param('id'));
    c.header('cache-control', 'no-store');
    c.header('pragma', 'no-cache');
    return c.json(details);
  });

  app.post('/v1/app/cards/:id/apple-pay', requireSession, requireFreshAuth, sensitiveLimit, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await armApplePay((await me(c)).userId, c.req.param('id')));
  });

  app.get('/v1/app/cards/:id/apple-pay', requireSession, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await getApplePay((await me(c)).userId, c.req.param('id')));
  });
}
