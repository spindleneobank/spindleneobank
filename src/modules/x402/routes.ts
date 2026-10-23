import type { Context, Hono } from 'hono';
import type { Hex } from 'viem';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { ipKey, rateLimit } from '../../lib/ratelimit';
import { HEADER_SESSION, PostX402SessionOpenReq, PostX402SessionsReq } from '../../shared/api/x402';
import { x402State } from './guard';
import './provider';
import { DISABLED_MESSAGE } from './guard';
import { noteClosing } from './provider';
import { closeSession, createSession, openSession, sessionByToken, sessionSpendable } from './sessions';

const ipLimit = rateLimit({ name: 'x402_ip', key: ipKey, points: 30, windowSec: 60 });

async function body<T>(
  c: Context<Env>,
  schema: {
    safeParse(
      v: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
  },
): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    throw new AppError(
      'VALIDATION',
      `Invalid request body: ${parsed.error.issues[0]?.message ?? 'malformed'}`,
    );
  return parsed.data;
}

/** Session routes. Auth is the session token itself (X-Spindle-Session), not the dashboard cookie. */
async function ownSession(c: Context<Env>, id: string) {
  const token = c.req.header(HEADER_SESSION);
  if (!token) throw new AppError('UNAUTHENTICATED', `Missing ${HEADER_SESSION} header.`);
  const row = await sessionByToken(token);
  if (!row || row.paymentId !== id.toLowerCase()) throw new AppError('NOT_FOUND', 'Unknown x402 session.');
  return row;
}

export default function x402Routes(app: Hono<Env>): void {
  app.post('/v1/x402/sessions', ipLimit, async (c) => {
    if (!(await x402State()).enabled) throw new AppError('PAYMENT_REQUIRED', DISABLED_MESSAGE);
    const req = await body(c, PostX402SessionsReq);
    let cap: bigint;
    try {
      cap = BigInt(req.capMicros);
    } catch {
      throw new AppError('VALIDATION', 'capMicros must be an integer string.');
    }
    return c.json(await createSession({ payer: req.payer, capMicros: cap, ttlSec: req.ttlSec }));
  });

  app.post('/v1/x402/sessions/:id/open', ipLimit, async (c) => {
    if (!(await x402State()).enabled) throw new AppError('PAYMENT_REQUIRED', DISABLED_MESSAGE);
    const req = await body(c, PostX402SessionOpenReq);
    return c.json(await openSession(c.req.param('id'), req.signature as Hex));
  });

  app.get('/v1/x402/sessions/:id', async (c) => {
    const row = await ownSession(c, c.req.param('id'));
    return c.json({
      status: row.status,
      usedMicros: row.usedMicros.toString(),
      spendableMicros: (row.status === 'open' ? sessionSpendable(row) : 0n).toString(),
      settleTx: row.settleTx,
    });
  });

  app.post('/v1/x402/sessions/:id/close', async (c) => {
    const row = await ownSession(c, c.req.param('id'));
    const r = await closeSession(row.id);
    if (r === 'closing') await noteClosing();
    return c.json({ status: 'closing' as const });
  });
}
