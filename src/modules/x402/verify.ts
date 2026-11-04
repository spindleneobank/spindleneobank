import { erc20Abi, permit2Abi } from '@spindle/shared/abi';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Redis } from 'ioredis';
import { type Address, type Hex, verifyTypedData } from 'viem';
import { config } from '../../config';
import { x402Payments } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { clientIp, hashIp, hit, ipBucket } from '../../lib/ratelimit';
import { getRedis } from '../../lib/redis';
import { publicClient } from '../../lib/viem';
import { decodeHeader, networkFor, spindlePaymentTypedData, X402PaymentHeader } from '../../shared/x402';
import { dbRef } from '../auth/constants';
import { challengeKey, type StoredChallenge, x402Addresses } from './challenge';

export const MIN_DEADLINE_LEAD_SEC = 30 * 60;
export const CHAIN_READ_TTL_MS = 10_000;
export const BARRED_KEY = 'x402:barred';

/** Limits on unsettled credit. Mutable so tests can lower them. */
export const x402Limits = {
  maxGlobalUnsettled: BigInt(config.X402_MAX_GLOBAL_UNSETTLED_MICROS),
  maxOpensPerIpDay: config.X402_MAX_OPENS_PER_IP_DAY,
  /** Credit a wallet with no settled payments gets, which is also the most it can default on. */
  newPayerCredit: BigInt(config.X402_NEW_PAYER_CREDIT_MICROS),
  /**
   * Extra credit per settled micro, in basis points. A node operator buying from their own node gets 80% back, so
   * history costs them 20% of what they settle: this has to stay below that, or farming credit to default on pays.
   */
  creditPerSettledBps: BigInt(config.X402_CREDIT_PER_SETTLED_BPS),
  maxNewPayersPerIpDay: config.X402_MAX_NEW_PAYERS_PER_IP_DAY,
};

const DAY_SEC = 86_400;

/** Limits how many payments one client IP can open per day. Fresh addresses are free; IPs less so. */
export async function enforceOpenIpCap(c: Context<Env>): Promise<void> {
  const ip = clientIp(c);
  if (ip === 'unknown') return; // never put all clients in one bucket
  const { count, retryAfter } = await hit(`x402:open:${hashIp(ipBucket(ip))}`, DAY_SEC);
  if (count > x402Limits.maxOpensPerIpDay) {
    c.header('retry-after', String(retryAfter));
    throw new AppError('RATE_LIMITED', 'Too many x402 payments from this address today. Use an API key.');
  }
}

export type PayerChainState = { balance: bigint; allowance: bigint };

/** Chain access, injectable for unit tests. */
export const chainDeps = {
  /** EOA recovery is local; ERC-1271 / 6492 wallets fall back to an on-chain check. */
  async verifySignature(args: {
    payer: Address;
    typedData: ReturnType<typeof spindlePaymentTypedData>;
    signature: Hex;
  }): Promise<boolean> {
    try {
      if (await verifyTypedData({ address: args.payer, ...args.typedData, signature: args.signature }))
        return true;
    } catch {
      // fall through to the contract-wallet path
    }
    try {
      return await publicClient.verifyTypedData({
        address: args.payer,
        ...args.typedData,
        signature: args.signature,
      });
    } catch {
      return false;
    }
  },
  /** Balance and allowance to Permit2, cached 10 s per payer. */
  async payerState(payer: Address): Promise<PayerChainState> {
    const hit = stateCache.get(payer);
    if (hit && Date.now() - hit.at < CHAIN_READ_TTL_MS) return hit.v;
    const a = x402Addresses();
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({ address: a.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [payer] }),
      publicClient.readContract({
        address: a.usdg,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [payer, a.permit2],
      }),
    ]);
    const v = { balance, allowance };
    stateCache.set(payer, { at: Date.now(), v });
    return v;
  },
  /** True when the Permit2 unordered nonce is already spent. Never cached. */
  async nonceUsed(payer: Address, nonce: bigint): Promise<boolean> {
    const bitmap = await publicClient.readContract({
      address: x402Addresses().permit2,
      abi: permit2Abi,
      functionName: 'nonceBitmap',
      args: [payer, nonce >> 8n],
    });
    return ((bitmap >> (nonce & 0xffn)) & 1n) === 1n;
  },
};
const stateCache = new Map<Address, { at: number; v: PayerChainState }>();
export const resetPayerCache = () => stateCache.clear();

const refuse = (message: string) => new AppError('PAYMENT_REQUIRED', message);

export async function isBarred(payer: string, redis: Redis = getRedis()): Promise<boolean> {
  return (await redis.sismember(BARRED_KEY, payer.toLowerCase())) === 1;
}

export type OpenInput = {
  scheme: 'exact' | 'session';
  payer: Address;
  paymentId: Hex;
  cap: bigint;
  surcharge: bigint;
  nonce: bigint;
  deadline: bigint;
  validAfter: bigint;
  signature: Hex;
  /** extra fields merged into `permit` jsonb */
  permitExtra?: Record<string, unknown>;
  sessionTokenHash?: string;
  clientIp?: string;
  /** Marks the challenge/pending session as used; false means someone else already consumed it. */
  consume: () => Promise<boolean>;
  nowSec?: number;
};

/** What the payer has signed for and may still be charged: the balance and allowance must cover this. */
const signedSum = sql<string>`coalesce(sum(case when ${x402Payments.status} = 'open' then ${x402Payments.capMicros}
  else ${x402Payments.usedMicros} + ${x402Payments.reservedMicros} + ${x402Payments.surchargeMicros} end), 0)`;
/**
 * Credit actually in use: served or reserved work not yet paid for. An unused session costs nobody anything, so it
 * counts only its surcharge. Counting its whole cap would let a few idle sessions lock everyone else out. A job
 * still in flight on a closed session is still credit, or closing a session would free its limit for free.
 */
const creditInUse = sql<string>`coalesce(sum(case
  when ${x402Payments.status} = 'open' and ${x402Payments.scheme} = 'session'
    then ${x402Payments.usedMicros} + ${x402Payments.reservedMicros} + coalesce(${x402Payments.surchargeMicros}, 0)
  when ${x402Payments.status} = 'open' then ${x402Payments.capMicros}
  else ${x402Payments.usedMicros} + ${x402Payments.reservedMicros} + coalesce(${x402Payments.surchargeMicros}, 0) end), 0)`;
const unsettled = sql`${x402Payments.status} in ('open','closing','settling')`;

type Tx = Parameters<Parameters<typeof dbRef.db.transaction>[0]>[0];
export type CreditRefusal = 'credit' | 'capacity';

/** Serialises credit checks, so parallel requests cannot jointly pass a limit. */
const lockCredit = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('x402:global'))`);

async function settledBy(db: Pick<Tx, 'select'>, payer: string): Promise<bigint> {
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${x402Payments.usedMicros}), 0)` })
    .from(x402Payments)
    .where(sql`${x402Payments.payer} = ${payer} and ${x402Payments.status} = 'settled'`);
  return BigInt(row?.v ?? '0');
}

/** A wallet's unsettled credit limit: small until it has paid, growing with what it has settled. */
export function creditLimit(settled: bigint): bigint {
  const earned = x402Limits.newPayerCredit + (settled * x402Limits.creditPerSettledBps) / 10_000n;
  const max = BigInt(config.X402_MAX_UNSETTLED_MICROS);
  return earned < max ? earned : max;
}

async function checkCredit(tx: Tx, payer: string, added: bigint): Promise<CreditRefusal | null> {
  const [all] = await tx.select({ v: creditInUse }).from(x402Payments).where(unsettled);
  if (BigInt(all?.v ?? '0') + added > x402Limits.maxGlobalUnsettled) return 'capacity';
  const [mine] = await tx
    .select({ v: creditInUse })
    .from(x402Payments)
    .where(sql`${x402Payments.payer} = ${payer} and ${unsettled}`);
  return BigInt(mine?.v ?? '0') + added > creditLimit(await settledBy(tx, payer)) ? 'credit' : null;
}

/** Takes `amount` of a session's credit for a request. Null on success. */
export async function reserveCredit(
  paymentRowId: string,
  payer: string,
  amount: bigint,
): Promise<CreditRefusal | 'closed' | null> {
  return dbRef.db.transaction(async (tx) => {
    await lockCredit(tx);
    const refused = await checkCredit(tx, payer, amount);
    if (refused) return refused;
    // only an open session takes new work: one closing at this moment may already be marked as having nothing to settle
    const taken = await tx
      .update(x402Payments)
      .set({ reservedMicros: sql`${x402Payments.reservedMicros} + ${amount}` })
      .where(sql`${x402Payments.id} = ${paymentRowId} and ${x402Payments.status} = 'open'`)
      .returning({ id: x402Payments.id });
    return taken.length > 0 ? null : 'closed';
  });
}

export const isNewPayer = async (payer: string): Promise<boolean> =>
  (await settledBy(dbRef.db, payer.toLowerCase())) === 0n;

/** Limits how many unproven wallets one IP can bring per day. A wallet already seen today is not counted twice. */
async function enforceNewPayerIpCap(ip: string, payer: string): Promise<void> {
  if (ip === 'unknown' || !(await isNewPayer(payer))) return;
  const redis = getRedis();
  const key = `x402:newpayers:${hashIp(ipBucket(ip))}`;
  const added = await redis.sadd(key, payer);
  await redis.expire(key, DAY_SEC);
  if (added === 1 && (await redis.scard(key)) > x402Limits.maxNewPayersPerIpDay) {
    await redis.srem(key, payer);
    throw new AppError('RATE_LIMITED', 'Too many new x402 wallets from this address today. Use an API key.');
  }
}

const CAPACITY_MESSAGE =
  'x402 is at capacity while earlier payments settle. Use an API key or try again shortly.';

/**
 * Steps 2-6 of "Gateway checks before dispatch": signature, deadline margin, on-chain nonce/balance/allowance,
 * credit limits and the per-payer signed cap, then the `open` row. The checks and the insert run under one
 * advisory lock, so parallel requests cannot jointly pass a limit.
 */
export async function verifyAndOpen(i: OpenInput): Promise<{ id: string }> {
  const now = BigInt(i.nowSec ?? Math.floor(Date.now() / 1000));
  const a = x402Addresses();
  const payer = i.payer.toLowerCase() as Address;
  if (i.surcharge > i.cap) throw refuse('Signed amount does not cover the surcharge.');
  if (i.validAfter > now) throw refuse('Payment is not valid yet.');
  if (i.deadline < now + BigInt(MIN_DEADLINE_LEAD_SEC)) {
    throw refuse('Payment deadline is too close (needs at least 30 minutes).');
  }
  if (await isBarred(payer)) {
    throw new AppError(
      'FORBIDDEN',
      'This wallet is barred from x402 payments pending review. Use an API key.',
    );
  }
  const typedData = spindlePaymentTypedData({
    chainId: config.CHAIN_ID,
    token: a.usdg,
    cap: i.cap,
    spender: a.vault,
    nonce: i.nonce,
    deadline: i.deadline,
    paymentId: i.paymentId,
    surcharge: i.surcharge,
    validAfter: i.validAfter,
    permit2: a.permit2,
  });
  if (!(await chainDeps.verifySignature({ payer, typedData, signature: i.signature }))) {
    throw refuse('Invalid payment signature.');
  }
  if (await chainDeps.nonceUsed(payer, i.nonce)) throw refuse('Payment nonce was already used on-chain.');
  if (i.clientIp) await enforceNewPayerIpCap(i.clientIp, payer);
  const chain = await chainDeps.payerState(payer);
  const max = BigInt(config.X402_MAX_UNSETTLED_MICROS);

  const id = await dbRef.db.transaction(async (tx) => {
    await lockCredit(tx);
    // an exact payment is reserved in full for its one job; a session reserves per request (`reserveCredit`)
    const refused = await checkCredit(tx, payer, i.scheme === 'session' ? i.surcharge : i.cap);
    if (refused === 'capacity') throw refuse(CAPACITY_MESSAGE);
    if (refused === 'credit') {
      throw refuse(
        'This payment is above the x402 credit limit for this wallet, which starts small and grows as payments settle. Wait for settlement, request fewer tokens, or use an API key.',
      );
    }
    const [row] = await tx
      .select({ v: signedSum })
      .from(x402Payments)
      .where(sql`${x402Payments.payer} = ${payer} and ${unsettled}`);
    const exposure = BigInt(row?.v ?? '0');
    if (exposure + i.cap > max) {
      throw refuse(
        `Unsettled x402 exposure would exceed the limit (${max} micros). Use an API key or wait for settlement.`,
      );
    }
    if (chain.balance < exposure + i.cap) throw refuse('Insufficient USDG balance for this payment.');
    if (chain.allowance < exposure + i.cap) throw refuse('Insufficient USDG allowance to Permit2.');
    const [ins] = await tx
      .insert(x402Payments)
      .values({
        paymentId: i.paymentId.toLowerCase(),
        payer,
        scheme: i.scheme,
        capMicros: i.cap,
        surchargeMicros: i.surcharge,
        nonce: i.nonce.toString(),
        deadline: i.deadline,
        validAfter: i.validAfter,
        signature: i.signature,
        permit: {
          permitted: { token: a.usdg, amount: i.cap.toString() },
          nonce: i.nonce.toString(),
          deadline: i.deadline.toString(),
          ...(i.permitExtra ?? {}),
        },
        status: 'open',
        sessionTokenHash: i.sessionTokenHash ?? null,
      })
      .onConflictDoNothing({ target: x402Payments.paymentId })
      .returning({ id: x402Payments.id });
    if (!ins) throw refuse('This payment was already submitted.');
    if (!(await i.consume())) throw refuse('This challenge was already used or has expired.');
    return ins.id;
  });
  return { id };
}

/** Fields of the paid retry that must equal what the server issued. */
function matchesChallenge(c: StoredChallenge, h: X402PaymentHeader['payload']): string | null {
  if (h.witness.paymentId.toLowerCase() !== c.paymentId) return 'witness paymentId mismatch';
  if (h.permit.permitted.token.toLowerCase() !== c.token) return 'token mismatch';
  if (h.permit.permitted.amount !== c.cap) return 'amount does not match the challenge';
  if (h.permit.nonce !== c.nonce) return 'nonce mismatch';
  if (h.permit.deadline !== c.deadline) return 'deadline mismatch';
  if (h.witness.surcharge !== c.surcharge) return 'surcharge mismatch';
  if (h.witness.validAfter !== c.validAfter) return 'validAfter mismatch';
  return null;
}

export type ExactVerified = { id: string; payer: Address; paymentId: Hex; cap: bigint; surcharge: bigint };
export class ChallengeStale extends Error {}

/**
 * Verifies an `X-PAYMENT` header end to end and records the `open` payment. Throws AppError (402) on any
 * failure; nothing may be dispatched before this returns. `requiredMicros` = maxCharge the job may consume.
 */
export async function verifyExactPayment(
  headerValue: string | undefined,
  requiredMicros: bigint,
  redis: Redis = getRedis(),
  clientIp?: string,
): Promise<ExactVerified> {
  let parsed: X402PaymentHeader;
  try {
    parsed = X402PaymentHeader.parse(decodeHeader(headerValue));
  } catch {
    throw new AppError('VALIDATION', 'Malformed X-PAYMENT header.', 400);
  }
  if (parsed.network !== networkFor(config.CHAIN_ID)) throw refuse('Payment is for a different network.');
  const p = parsed.payload;
  const paymentId = p.paymentId.toLowerCase() as Hex;
  if (p.witness.paymentId.toLowerCase() !== paymentId) throw refuse('Payment id mismatch.');
  const raw = await redis.get(challengeKey(paymentId));
  if (!raw) throw refuse('Unknown, expired or already used payment challenge.');
  const challenge = JSON.parse(raw) as StoredChallenge;
  const mismatch = matchesChallenge(challenge, p);
  if (mismatch) throw refuse(`Payment does not match the challenge: ${mismatch}.`);
  const cap = BigInt(challenge.cap);
  const surcharge = BigInt(challenge.surcharge);
  if (cap - surcharge < requiredMicros) {
    // The request now needs more than the signed cap (rates moved or different body): issue a new challenge.
    await redis.del(challengeKey(paymentId));
    throw new ChallengeStale();
  }
  const { id } = await verifyAndOpen({
    scheme: 'exact',
    payer: p.payer as Address,
    paymentId,
    cap,
    surcharge,
    nonce: BigInt(challenge.nonce),
    deadline: BigInt(challenge.deadline),
    validAfter: BigInt(challenge.validAfter),
    signature: p.signature as Hex,
    ...(clientIp ? { clientIp } : {}),
    consume: async () => (await redis.getdel(challengeKey(paymentId))) !== null,
  });
  return { id, payer: p.payer.toLowerCase() as Address, paymentId, cap, surcharge };
}
