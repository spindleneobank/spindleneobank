import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Address, Hex } from 'viem';
import { config } from '../../config';
import { x402Payments } from '../../db/schema';
import type { X402Payment } from '../../db/types';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { SESSION_MAX_CAP_MICROS_DEFAULT, SESSION_MAX_TTL_SEC } from '../../shared/api/x402';
import { spindlePaymentTypedData } from '../../shared/x402';
import { dbRef } from '../auth/constants';
import { randomNonce, randomPaymentId, x402Addresses } from './challenge';
import { currentSurchargeMicros } from './surcharge';
import { verifyAndOpen } from './verify';

export const SESSION_MAX_CAP_MICROS = SESSION_MAX_CAP_MICROS_DEFAULT;
export const PENDING_TTL_SEC = 600;
export const SETTLE_GRACE_SEC = 3600;
export const sessionKey = (paymentId: string) => `x402:session:${paymentId.toLowerCase()}`;
const pendingKey = (id: string) => `x402:session-pending:${id.toLowerCase()}`;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

// ---- Redis reservation counters ----------------------------------------------------------------

// KEYS[1] hash{used,reserved,closed}; ARGV: spendable, amount, initUsed, ttlMs. Returns remaining after the
// reservation, -1 when exhausted, -2 when the session is closed.
const RESERVE_LUA = `
if redis.call('exists', KEYS[1]) == 0 then
  redis.call('hset', KEYS[1], 'used', ARGV[3], 'reserved', ARGV[5], 'closed', 0)
end
redis.call('pexpire', KEYS[1], ARGV[4])
if redis.call('hget', KEYS[1], 'closed') == '1' then return -2 end
local used = tonumber(redis.call('hget', KEYS[1], 'used'))
local reserved = tonumber(redis.call('hget', KEYS[1], 'reserved'))
local avail = tonumber(ARGV[1]) - used - reserved
local amount = tonumber(ARGV[2])
if amount > avail then return -1 end
redis.call('hincrby', KEYS[1], 'reserved', amount)
return avail - amount`;
// ARGV: reservedAmount, charge. Moves the reservation into used. Returns used after.
const FINALIZE_LUA = `
if redis.call('exists', KEYS[1]) == 0 then return -1 end
redis.call('hincrby', KEYS[1], 'reserved', -tonumber(ARGV[1]))
redis.call('hincrby', KEYS[1], 'used', tonumber(ARGV[2]))
return tonumber(redis.call('hget', KEYS[1], 'used'))`;

export type Reservation = { remaining: bigint } | { exhausted: true } | { closed: true };

export async function reserveSession(
  row: Pick<
    X402Payment,
    'id' | 'paymentId' | 'capMicros' | 'surchargeMicros' | 'usedMicros' | 'reservedMicros'
  >,
  amount: bigint,
  ttlMs: number,
  redis: Redis = getRedis(),
): Promise<Reservation> {
  const spendable = (row.capMicros ?? 0n) - (row.surchargeMicros ?? 0n);
  const r = Number(
    await redis.eval(
      RESERVE_LUA,
      1,
      sessionKey(row.paymentId),
      spendable.toString(),
      amount.toString(),
      row.usedMicros.toString(),
      String(Math.max(ttlMs, 60_000)),
      row.reservedMicros.toString(),
    ),
  );
  if (r === -1) return { exhausted: true };
  if (r === -2) return { closed: true };
  try {
    await dbRef.db
      .update(x402Payments)
      .set({ reservedMicros: sql`${x402Payments.reservedMicros} + ${amount}` })
      .where(eq(x402Payments.id, row.id));
  } catch (err) {
    await redis.eval(FINALIZE_LUA, 1, sessionKey(row.paymentId), amount.toString(), '0').catch(() => {});
    throw err;
  }
  return { remaining: BigInt(r) };
}

/** Move `reserved` into `used` (charge may be 0 = release). Persists used to the DB; closes at the cap. */
export async function settleSessionUse(
  paymentRowId: string,
  reserved: bigint,
  charge: bigint,
  redis: Redis = getRedis(),
): Promise<{ used: bigint; closing: boolean }> {
  const [row] = await dbRef.db.select().from(x402Payments).where(eq(x402Payments.id, paymentRowId));
  if (!row) throw new AppError('NOT_FOUND', 'x402 session not found.');
  const spendable = (row.capMicros ?? 0n) - (row.surchargeMicros ?? 0n);
  const c = charge > reserved ? reserved : charge;
  await redis
    .eval(FINALIZE_LUA, 1, sessionKey(row.paymentId), reserved.toString(), c.toString())
    .catch((err) =>
      logger.warn({ err: String(err) }, 'x402: session counter update failed (DB is authoritative)'),
    );
  const [upd] = await dbRef.db
    .update(x402Payments)
    .set({
      usedMicros: sql`${x402Payments.usedMicros} + ${c}`,
      reservedMicros: sql`greatest(${x402Payments.reservedMicros} - ${reserved}, 0)`,
    })
    .where(eq(x402Payments.id, paymentRowId))
    .returning({ used: x402Payments.usedMicros });
  const used = upd?.used ?? row.usedMicros + c;
  const exhausted = used >= spendable;
  if (exhausted) await closeSession(paymentRowId, redis);
  return { used, closing: exhausted };
}

/**
 * Stop accepting requests and queue the payment for the next batch (`closing`), or `expired` when nothing
 * was used (nothing to settle, so the payer pays no surcharge). Idempotent; only touches `open` rows.
 */
export async function closeSession(
  paymentRowId: string,
  redis: Redis = getRedis(),
): Promise<'closing' | 'expired' | null> {
  const [row] = await dbRef.db.select().from(x402Payments).where(eq(x402Payments.id, paymentRowId));
  if (!row) return null;
  await redis.hset(sessionKey(row.paymentId), 'closed', 1).catch(() => {});
  const next = row.usedMicros > 0n || row.reservedMicros > 0n ? 'closing' : 'expired';
  const upd = await dbRef.db
    .update(x402Payments)
    .set({ status: next, closedAt: new Date() })
    .where(and(eq(x402Payments.id, paymentRowId), eq(x402Payments.status, 'open')))
    .returning({ id: x402Payments.id });
  if (upd.length > 0 && next === 'closing') await redis.incr(CLOSING_COUNTER).catch(() => {});
  return upd.length > 0 ? next : null;
}
export const CLOSING_COUNTER = 'x402:closing-count';

export async function sessionByToken(token: string): Promise<X402Payment | undefined> {
  const [row] = await dbRef.db
    .select()
    .from(x402Payments)
    .where(and(eq(x402Payments.sessionTokenHash, hashToken(token)), eq(x402Payments.scheme, 'session')));
  return row;
}

export const sessionExpiresAt = (row: Pick<X402Payment, 'permit'>): number =>
  Number((row.permit as { expiresAt?: number } | null)?.expiresAt ?? 0);

// ---- create / open -------------------------------------------------------------------------------

type Pending = {
  payer: Address;
  capMicros: string;
  surchargeMicros: string;
  ttlSec: number;
  nonce: string;
  deadline: string;
  validAfter: string;
};

const jsonSafe = <T>(v: T): T =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export async function createSession(
  input: { payer: string; capMicros: bigint; ttlSec: number },
  redis: Redis = getRedis(),
  nowSec = Math.floor(Date.now() / 1000),
) {
  if (input.ttlSec > SESSION_MAX_TTL_SEC)
    throw new AppError('VALIDATION', `ttlSec must be <= ${SESSION_MAX_TTL_SEC}.`);
  if (input.capMicros > SESSION_MAX_CAP_MICROS) {
    throw new AppError('VALIDATION', `capMicros must be <= ${SESSION_MAX_CAP_MICROS}.`);
  }
  const surcharge = await currentSurchargeMicros();
  if (surcharge === null)
    throw new AppError(
      'PAYMENT_REQUIRED',
      'x402 temporarily unavailable — use an API key with a credit balance',
    );
  if (input.capMicros <= surcharge) {
    throw new AppError('VALIDATION', `capMicros must exceed the surcharge (${surcharge} micros).`);
  }
  const a = x402Addresses();
  const paymentId = randomPaymentId();
  const pending: Pending = {
    payer: input.payer.toLowerCase() as Address,
    capMicros: input.capMicros.toString(),
    surchargeMicros: surcharge.toString(),
    ttlSec: input.ttlSec,
    nonce: randomNonce().toString(),
    // the signature stays valid for the pending window + session ttl + a full hour for batching
    deadline: String(nowSec + PENDING_TTL_SEC + input.ttlSec + SETTLE_GRACE_SEC),
    validAfter: String(nowSec - 60),
  };
  await redis.set(pendingKey(paymentId), JSON.stringify(pending), 'EX', PENDING_TTL_SEC);
  const typedData = spindlePaymentTypedData({
    chainId: config.CHAIN_ID,
    token: a.usdg,
    cap: input.capMicros,
    spender: a.vault,
    nonce: BigInt(pending.nonce),
    deadline: BigInt(pending.deadline),
    paymentId,
    surcharge,
    validAfter: BigInt(pending.validAfter),
    permit2: a.permit2,
  });
  return {
    sessionId: paymentId,
    typedData: jsonSafe(typedData),
    surchargeMicros: surcharge.toString(),
    expiresAt: new Date((nowSec + input.ttlSec) * 1000).toISOString(),
  };
}

export async function openSession(
  sessionId: string,
  signature: Hex,
  redis: Redis = getRedis(),
  nowSec = Math.floor(Date.now() / 1000),
) {
  const raw = await redis.get(pendingKey(sessionId));
  if (!raw) throw new AppError('NOT_FOUND', 'Unknown or expired session request.');
  const p = JSON.parse(raw) as Pending;
  const token = randomBytes(32).toString('base64url');
  const expiresAtSec = nowSec + p.ttlSec;
  const cap = BigInt(p.capMicros);
  const surcharge = BigInt(p.surchargeMicros);
  await verifyAndOpen({
    scheme: 'session',
    payer: p.payer,
    paymentId: sessionId.toLowerCase() as Hex,
    cap,
    surcharge,
    nonce: BigInt(p.nonce),
    deadline: BigInt(p.deadline),
    validAfter: BigInt(p.validAfter),
    signature,
    permitExtra: { expiresAt: expiresAtSec, ttlSec: p.ttlSec },
    sessionTokenHash: hashToken(token),
    consume: async () => (await redis.getdel(pendingKey(sessionId))) !== null,
    nowSec,
  });
  return {
    sessionToken: token,
    capMicros: cap.toString(),
    surchargeMicros: surcharge.toString(),
    spendableMicros: (cap - surcharge).toString(),
    expiresAt: new Date(expiresAtSec * 1000).toISOString(),
  };
}

export const sessionSpendable = (
  row: Pick<X402Payment, 'capMicros' | 'surchargeMicros' | 'usedMicros'>,
): bigint => {
  const v = (row.capMicros ?? 0n) - (row.surchargeMicros ?? 0n) - row.usedMicros;
  return v > 0n ? v : 0n;
};
