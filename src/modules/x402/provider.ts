import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { config } from '../../config';
import { x402Payments } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { logger } from '../../lib/logger';
import { enqueue } from '../../lib/queue';
import { clientIp, hashIp, hit } from '../../lib/ratelimit';
import { getRedis } from '../../lib/redis';
import { HEADER_SESSION } from '../../shared/api/x402';
import { encodeHeader, X402PaymentResponse } from '../../shared/x402';
import { dbRef } from '../auth/constants';
import { buyerIdForAddress, refundCharge } from '../buyers/service';
import {
  API_RATE_LIMIT,
  type Authorization,
  type AuthorizeCtx,
  type Challenge,
  type PaymentProvider,
  registerPaymentProvider,
} from '../gateway/payment';
import { buildChallenge } from './challenge';
import { DISABLED_MESSAGE, x402State } from './guard';
import {
  CLOSING_COUNTER,
  reserveSession,
  sessionByToken,
  sessionExpiresAt,
  settleSessionUse,
} from './sessions';
import { currentSurchargeMicros } from './surcharge';
import { ChallengeStale, enforceOpenIpCap, verifyExactPayment } from './verify';

export const SETTLE_TRIGGER = 20;
export const CHALLENGE_IP_LIMIT = { points: 60, windowSec: 60 } as const;

const errBody = (code: string, message: string, type = 'invalid_request_error') => ({
  error: { message, type, code },
});
const refusal = (code: string, message: string, headers?: Record<string, string>): Challenge => ({
  challenge: true,
  status: 402,
  body: errBody(code, message),
  ...(headers ? { headers } : {}),
});

type Ref = { scheme: 'exact' | 'session'; paymentId: string; surcharge: string };

/** Counts a payment that became `closing`; kicks the settle job once 20 are waiting. */
export async function noteClosing(): Promise<void> {
  try {
    const n = await getRedis().incr(CLOSING_COUNTER);
    if (n >= SETTLE_TRIGGER)
      await enqueue(
        'x402',
        'x402-settle',
        { reason: 'closing-threshold' },
        { jobId: `x402-settle-now-${Math.floor(Date.now() / 60_000)}` },
      );
  } catch (err) {
    logger.warn({ err: String(err) }, 'x402: could not signal settlement trigger');
  }
}

/** `X-PAYMENT-RESPONSE` value for a finished job (the gateway sets it where it can; see report). */
export const paymentResponseHeader = (paymentId: string, used: bigint, surcharge: bigint): string =>
  encodeHeader(
    X402PaymentResponse.parse({
      paymentId,
      used: used.toString(),
      surcharge: surcharge.toString(),
      settlement: 'batched',
    }),
  );

export class X402Provider implements PaymentProvider {
  readonly name = 'x402';

  /** Anything that is not a balance credential ends up here, including bare requests (they get the challenge). */
  handles(_c: Context<Env>): boolean {
    return config.X402_ENABLED;
  }

  async authorize(c: Context<Env>, ctx: AuthorizeCtx): Promise<Authorization | Challenge> {
    const state = await x402State();
    if (!state.enabled) return refusal('X402_DISABLED', DISABLED_MESSAGE);
    const sessionToken = c.req.header(HEADER_SESSION);
    if (sessionToken) return this.authorizeSession(sessionToken, ctx);
    const payment = c.req.header('x-payment');
    if (payment) {
      await enforceOpenIpCap(c);
      try {
        return await this.authorizeExact(payment, ctx);
      } catch (err) {
        if (err instanceof ChallengeStale) return this.challenge(c, ctx);
        throw err;
      }
    }
    return this.challenge(c, ctx);
  }

  private async challenge(c: Context<Env>, ctx: AuthorizeCtx): Promise<Challenge> {
    const { count, retryAfter } = await hit(`x402chal:${hashIp(clientIp(c))}`, CHALLENGE_IP_LIMIT.windowSec);
    if (count > CHALLENGE_IP_LIMIT.points) {
      c.header('retry-after', String(retryAfter));
      throw new AppError('RATE_LIMITED', 'Too many payment challenges. Please slow down.');
    }
    const surcharge = await currentSurchargeMicros();
    if (surcharge === null) return refusal('X402_DISABLED', DISABLED_MESSAGE);
    const url = new URL(c.req.url);
    const { body, header } = await buildChallenge({
      url: `${config.PUBLIC_API_URL.replace(/\/$/, '')}${url.pathname}`,
      maxChargeMicros: ctx.maxChargeMicros,
      surchargeMicros: surcharge,
      priceBasis: ctx.priceBasis ?? { unitKind: 'tokens_1m', buyerMicrosPerUnit: 0n },
    });
    return { challenge: true, status: 402, headers: { 'PAYMENT-REQUIRED': header }, body };
  }

  private async authorizeExact(header: string, ctx: AuthorizeCtx): Promise<Authorization> {
    const v = await verifyExactPayment(header, ctx.maxChargeMicros);
    const buyerId = await buyerIdForAddress(v.payer);
    return {
      provider: this.name,
      payMode: 'x402',
      buyerId,
      jobId: ctx.jobId,
      reservedMicros: ctx.maxChargeMicros,
      x402PaymentId: v.id,
      ref: { scheme: 'exact', paymentId: v.paymentId, surcharge: v.surcharge.toString() } satisfies Ref,
    };
  }

  private async authorizeSession(token: string, ctx: AuthorizeCtx): Promise<Authorization | Challenge> {
    const row = await sessionByToken(token);
    if (!row) throw new AppError('UNAUTHENTICATED', 'Unknown x402 session.');
    const { count } = await hit(`gw:x402s:${row.id}`, API_RATE_LIMIT.windowSec);
    if (count > API_RATE_LIMIT.points)
      throw new AppError('RATE_LIMITED', 'Rate limit exceeded (60 requests per minute).');
    const expiresMs = sessionExpiresAt(row) * 1000;
    if (row.status !== 'open' || expiresMs <= Date.now()) {
      return refusal('SESSION_CLOSED', 'This x402 session is closed or expired. Open a new session.');
    }
    const r = await reserveSession(row, ctx.maxChargeMicros, expiresMs - Date.now() + 3600_000);
    if ('exhausted' in r)
      return refusal('SESSION_EXHAUSTED', 'The x402 session has no spendable balance left for this request.');
    if ('closed' in r)
      return refusal('SESSION_CLOSED', 'This x402 session is closed or expired. Open a new session.');
    const buyerId = await buyerIdForAddress(row.payer);
    return {
      provider: this.name,
      payMode: 'x402',
      buyerId,
      jobId: ctx.jobId,
      reservedMicros: ctx.maxChargeMicros,
      x402PaymentId: row.id,
      ref: {
        scheme: 'session',
        paymentId: row.paymentId,
        surcharge: (row.surchargeMicros ?? 0n).toString(),
      } satisfies Ref,
    };
  }

  responseHeaders(auth: Authorization, chargedMicros: bigint): Record<string, string> {
    const ref = auth.ref as Ref | undefined;
    if (!ref) return {};
    const used = chargedMicros > auth.reservedMicros ? auth.reservedMicros : chargedMicros;
    return { 'X-PAYMENT-RESPONSE': paymentResponseHeader(ref.paymentId, used, BigInt(ref.surcharge)) };
  }

  async finalize(auth: Authorization, chargeMicros: bigint): Promise<bigint> {
    const ref = auth.ref as Ref;
    const id = auth.x402PaymentId as string;
    const charge = chargeMicros > auth.reservedMicros ? auth.reservedMicros : chargeMicros;
    if (ref.scheme === 'session') {
      const r = await settleSessionUse(id, auth.reservedMicros, charge);
      if (r.closing) await noteClosing();
      return charge;
    }
    if (charge === 0n) {
      await this.release(auth);
      return 0n;
    }
    const upd = await dbRef.db
      .update(x402Payments)
      .set({ usedMicros: charge, status: 'closing', closedAt: new Date() })
      .where(and(eq(x402Payments.id, id), eq(x402Payments.status, 'open')))
      .returning({ id: x402Payments.id });
    if (upd.length > 0) await noteClosing();
    return charge;
  }

  /**
   * A charge `finalize` applied is undone (receipt failed). Session: `used` goes back down while the
   * session has not settled on-chain; exact: the payment is voided while it has not settled. Once the
   * payment is `settling`/`settled` on-chain the money has moved, so the payer gets a `refund` credit entry
   * on their prepaid balance instead.
   */
  async reverse(auth: Authorization, chargedMicros: bigint): Promise<void> {
    const ref = auth.ref as Ref;
    const id = auth.x402PaymentId as string;
    const [row] = await dbRef.db.select().from(x402Payments).where(eq(x402Payments.id, id));
    if (!row) return;
    const unsettled = row.status === 'open' || row.status === 'closing';
    if (unsettled && ref.scheme === 'session') {
      await settleSessionUse(id, 0n, -chargedMicros);
      return;
    }
    if (unsettled) {
      await dbRef.db
        .update(x402Payments)
        .set({ usedMicros: 0n, status: 'expired', closedAt: new Date() })
        .where(and(eq(x402Payments.id, id), eq(x402Payments.status, row.status)));
      return;
    }
    await refundCharge(auth.buyerId, chargedMicros, auth.jobId);
  }

  /**
   * Failed or cancelled job. Exact: the payment is marked `expired` and never settled, so a failed job costs the
   * payer nothing (no surcharge either; the surcharge only covers gas for payments that do settle). Session: the
   * reservation is returned.
   */
  async release(auth: Authorization): Promise<void> {
    const ref = auth.ref as Ref;
    const id = auth.x402PaymentId as string;
    if (ref.scheme === 'session') {
      await settleSessionUse(id, auth.reservedMicros, 0n);
      return;
    }
    await dbRef.db
      .update(x402Payments)
      .set({ status: 'expired', closedAt: new Date() })
      .where(and(eq(x402Payments.id, id), eq(x402Payments.status, 'open')));
  }
}

export const x402Provider = new X402Provider();
registerPaymentProvider('x402', x402Provider);
