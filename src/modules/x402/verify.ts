import { erc20Abi, permit2Abi } from '@spindle/shared/abi';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { type Address, type Hex, verifyTypedData } from 'viem';
import { config } from '../../config';
import { x402Payments } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { getRedis } from '../../lib/redis';
import { publicClient } from '../../lib/viem';
import { decodeHeader, networkFor, spindlePaymentTypedData, X402PaymentHeader } from '../../shared/x402';
import { dbRef } from '../auth/constants';
import { challengeKey, type StoredChallenge, x402Addresses } from './challenge';

export const MIN_DEADLINE_LEAD_SEC = 30 * 60;
export const CHAIN_READ_TTL_MS = 10_000;
export const BARRED_KEY = 'x402:barred';

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
  /** Marks the challenge/pending session as used; false means someone else already consumed it. */
  consume: () => Promise<boolean>;
  nowSec?: number;
};

/**
 * Steps 2-6 of "Gateway checks before dispatch": signature, deadline margin, on-chain nonce/balance/allowance,
 * per-payer exposure cap, then the `open` row. The exposure check and insert run under a per-payer advisory
 * lock, so parallel requests cannot jointly exceed X402_MAX_UNSETTLED_MICROS.
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
  const chain = await chainDeps.payerState(payer);
  const max = BigInt(config.X402_MAX_UNSETTLED_MICROS);

  const id = await dbRef.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`x402:${payer}`}))`);
    const [row] = await tx
      .select({
        v: sql<string>`coalesce(sum(case when ${x402Payments.status} = 'open' then ${x402Payments.capMicros}
          else ${x402Payments.usedMicros} + ${x402Payments.surchargeMicros} end), 0)`,
      })
      .from(x402Payments)
      .where(
        sql`${x402Payments.payer} = ${payer} and ${x402Payments.status} in ('open','closing','settling')`,
      );
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
    consume: async () => (await redis.getdel(challengeKey(paymentId))) !== null,
  });
  return { id, payer: p.payer.toLowerCase() as Address, paymentId, cap, surcharge };
}
