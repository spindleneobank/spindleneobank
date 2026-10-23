import type { Context } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { hit } from '../../lib/ratelimit';
import type { JobKind, Lane, PayMode } from '../../shared/enums';
import { csrf, sessionLoader } from '../auth/middleware';
import { verifyApiKey } from '../buyers/apikeys';
import { buyerIdForAddress, release, reserve, settleCharge } from '../buyers/service';

export const API_RATE_LIMIT = { points: 60, windowSec: 60 } as const;

/** What the provider needs to size and bind the authorization. */
export interface AuthorizeCtx {
  jobId: string;
  model: string;
  kind: JobKind;
  lane: Lane;
  /** Upper bound the gateway will reserve (USDG micros). */
  maxChargeMicros: bigint;
  /** Result of `identify`, when the gateway ran it before the capacity check. */
  identity?: PayerIdentity;
  /** Pricing basis for challenges. */
  priceBasis?: { unitKind: string; buyerMicrosPerUnit: bigint; maxTokens?: number };
}

export interface PayerIdentity {
  buyerId: string;
  keyId?: string;
}

/** Funds are reserved. Serializable (bigint as string) so B7 can settle from another process. */
export interface Authorization {
  provider: string;
  payMode: Extract<PayMode, 'balance' | 'x402'>;
  buyerId: string;
  jobId: string;
  reservedMicros: bigint;
  /** x402_payments.id when payMode = x402 */
  x402PaymentId?: string;
  /** provider-private state (must be JSON-serializable) */
  ref?: unknown;
}

/** A 402 (or other non-success) answer the gateway sends verbatim; nothing was reserved. */
export interface Challenge {
  challenge: true;
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export const isChallenge = (x: Authorization | Challenge): x is Challenge =>
  (x as Challenge).challenge === true;

export interface PaymentProvider {
  readonly name: string;
  /** True when this request carries (or should be answered with) this provider's credentials. */
  handles(c: Context<Env>): boolean;
  /**
   * Cheap credential check run BEFORE the capacity check (401 / 429 for bad or abusive callers).
   * Must not reserve or charge anything.
   */
  identify?(c: Context<Env>): Promise<PayerIdentity | undefined>;
  /** Reserve funds for `ctx.maxChargeMicros`, or return a Challenge. Throws AppError on refusal. */
  authorize(c: Context<Env>, ctx: AuthorizeCtx): Promise<Authorization | Challenge>;
  /** Charge `chargeMicros` (clamped to the reservation) and drop the reservation. Returns the amount charged. */
  finalize(auth: Authorization, chargeMicros: bigint): Promise<bigint>;
  /** Drop the reservation without charging. */
  release(auth: Authorization): Promise<void>;
}

const providers = new Map<string, PaymentProvider>();

/** B10 registers `registerPaymentProvider('x402', provider)`; tests may replace providers. */
export function registerPaymentProvider(name: string, provider: PaymentProvider): void {
  providers.set(name, provider);
}
export const getPaymentProvider = (name: string): PaymentProvider | undefined => providers.get(name);
export const unregisterPaymentProvider = (name: string): void => void providers.delete(name);

/** Balance first (API key / dashboard cookie), then x402 (X-PAYMENT, X-Spindle-Session or a bare request). */
export function selectProvider(c: Context<Env>): PaymentProvider {
  const balance = providers.get('balance');
  if (balance?.handles(c)) return balance;
  const x402 = providers.get('x402');
  if (x402?.handles(c)) return x402;
  throw new AppError(
    'UNAUTHENTICATED',
    'Missing credentials. Send "Authorization: Bearer sk-spdl-..." with an API key from the dashboard.',
  );
}

function bearer(c: Context<Env>): string | undefined {
  const h = c.req.header('authorization');
  const m = h && /^Bearer\s+(\S+)$/i.exec(h);
  return m?.[1];
}

async function limit(c: Context<Env>, id: string): Promise<void> {
  const { count, retryAfter } = await hit(`gw:${id}`, API_RATE_LIMIT.windowSec);
  if (count > API_RATE_LIMIT.points) {
    c.header('retry-after', String(retryAfter));
    throw new AppError('RATE_LIMITED', 'Rate limit exceeded (60 requests per minute).');
  }
}

/** Prepaid balance via `Authorization: Bearer sk-spdl-...` or the dashboard cookie + `x-spindle-pay: balance`. */
export class BalanceProvider implements PaymentProvider {
  readonly name = 'balance';

  handles(c: Context<Env>): boolean {
    const key = bearer(c);
    if (key) return true;
    return c.req.header('x-spindle-pay') === 'balance' && !c.req.header('x-payment');
  }

  async identify(c: Context<Env>): Promise<PayerIdentity> {
    const key = bearer(c);
    if (key) {
      const found = await verifyApiKey(key);
      if (!found) throw new AppError('UNAUTHENTICATED', 'Invalid or revoked API key.');
      await limit(c, `key:${found.keyId}`);
      return found;
    }
    // Cookie auth: the gateway sits outside the cookie-protected prefixes, so run CSRF and the session loader here.
    await csrf(c, async () => {});
    await sessionLoader(c, async () => {});
    const address = c.get('user')?.address;
    if (!address) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    const buyerId = await buyerIdForAddress(address);
    await limit(c, `buyer:${buyerId}`);
    return { buyerId };
  }

  async authorize(c: Context<Env>, ctx: AuthorizeCtx): Promise<Authorization> {
    const id = ctx.identity ?? (await this.identify(c));
    await reserve(id.buyerId, ctx.maxChargeMicros); // INSUFFICIENT_BALANCE -> 402
    return {
      provider: this.name,
      payMode: 'balance',
      buyerId: id.buyerId,
      jobId: ctx.jobId,
      reservedMicros: ctx.maxChargeMicros,
    };
  }

  finalize(auth: Authorization, chargeMicros: bigint): Promise<bigint> {
    return settleCharge(auth.buyerId, auth.reservedMicros, chargeMicros, auth.jobId);
  }

  release(auth: Authorization): Promise<void> {
    return release(auth.buyerId, auth.reservedMicros);
  }
}

registerPaymentProvider('balance', new BalanceProvider());

// ---- serialization (bigint-safe) for cross-process settlement -----------------------------------

export const serializeAuth = (a: Authorization): string =>
  JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? { $big: v.toString() } : v));
export const parseAuth = (s: string): Authorization =>
  JSON.parse(s, (_k, v) => (v && typeof v === 'object' && '$big' in v ? BigInt(v.$big) : v)) as Authorization;
