import { randomBytes } from 'node:crypto';
import { KNOWN } from '@spindle/shared/chain';
import type { Redis } from 'ioredis';
import type { Address, Hex } from 'viem';
import { config } from '../../config';
import { requireAddress } from '../../lib/contracts';
import { getRedis } from '../../lib/redis';
import {
  encodeHeader,
  networkFor,
  SPINDLE_PAYMENT_TYPE,
  X402_VERSION,
  type X402Challenge,
} from '../../shared/x402';

export const CHALLENGE_TTL_SEC = 600;
export const CHALLENGE_DEADLINE_SEC = 3600;
export const VALID_AFTER_SKEW_SEC = 60;
export const MAX_TIMEOUT_SEC = 300;
export const challengeKey = (paymentId: string) => `x402:challenge:${paymentId.toLowerCase()}`;

/** Resolved contract addresses (config, falling back to the known RHC deployments). */
export type X402Addresses = { usdg: Address; vault: Address; permit2: Address };
/** Test seam: set to bypass config for the contract addresses. */
export const addressOverride: { current?: X402Addresses } = {};
export function x402Addresses(): X402Addresses {
  if (addressOverride.current) return addressOverride.current;
  return {
    usdg: ((config.USDG_ADDRESS as Address | undefined) ?? KNOWN.USDG).toLowerCase() as Address,
    vault: requireAddress('vault').toLowerCase() as Address,
    permit2: ((config.PERMIT2_ADDRESS as Address | undefined) ?? KNOWN.PERMIT2).toLowerCase() as Address,
  };
}

/** Random 248-bit Permit2 nonce (leaves the top byte clear so it never collides with a counter-style nonce). */
export const randomNonce = (): bigint => BigInt(`0x${randomBytes(31).toString('hex')}`);
export const randomPaymentId = (): Hex => `0x${randomBytes(32).toString('hex')}`;

/** What the server remembers about an issued challenge; the paid retry must match it exactly. */
export type StoredChallenge = {
  paymentId: Hex;
  cap: string;
  surcharge: string;
  validAfter: string;
  deadline: string;
  nonce: string;
  token: Address;
  spender: Address;
};

export type BuildChallengeInput = {
  url: string;
  maxChargeMicros: bigint;
  surchargeMicros: bigint;
  priceBasis: { unitKind: string; buyerMicrosPerUnit: bigint; maxTokens?: number };
  now?: number;
  redis?: Redis;
  addresses?: { usdg: Address; vault: Address; permit2: Address };
};

/** Builds the 402 challenge (payments-x402.md), stores it in Redis for 10 min and returns header + body. */
export async function buildChallenge(i: BuildChallengeInput): Promise<{
  body: X402Challenge;
  header: string;
  stored: StoredChallenge;
}> {
  const a = i.addresses ?? x402Addresses();
  const now = i.now ?? Math.floor(Date.now() / 1000);
  const cap = i.maxChargeMicros + i.surchargeMicros;
  const stored: StoredChallenge = {
    paymentId: randomPaymentId(),
    cap: cap.toString(),
    surcharge: i.surchargeMicros.toString(),
    validAfter: String(now - VALID_AFTER_SKEW_SEC),
    deadline: String(now + CHALLENGE_DEADLINE_SEC),
    nonce: randomNonce().toString(),
    token: a.usdg,
    spender: a.vault,
  };
  const body: X402Challenge = {
    x402Version: X402_VERSION,
    resource: { url: i.url, description: 'Spindle inference', mimeType: 'application/json' },
    accepts: [
      {
        scheme: 'exact',
        network: networkFor(config.CHAIN_ID),
        asset: a.usdg,
        amount: stored.cap,
        payTo: a.vault,
        maxTimeoutSeconds: MAX_TIMEOUT_SEC,
        extra: {
          assetTransferMethod: 'permit2-witness',
          permit2: a.permit2,
          spender: a.vault,
          witnessType: SPINDLE_PAYMENT_TYPE,
          paymentId: stored.paymentId,
          surcharge: stored.surcharge,
          validAfter: stored.validAfter,
          deadline: stored.deadline,
          nonce: stored.nonce,
          priceBasis: {
            unitKind: i.priceBasis.unitKind,
            buyerMicrosPerUnit: i.priceBasis.buyerMicrosPerUnit.toString(),
            maxTokens: i.priceBasis.maxTokens ?? 0,
          },
        },
      },
    ],
  };
  await (i.redis ?? getRedis()).set(
    challengeKey(stored.paymentId),
    JSON.stringify(stored),
    'EX',
    CHALLENGE_TTL_SEC,
  );
  return { body, header: encodeHeader(body), stored };
}
