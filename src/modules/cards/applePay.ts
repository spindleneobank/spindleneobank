import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { cards } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { getRedis } from '../../lib/redis';
import type { GetCardApplePayRes } from '../../shared/api/cards';
import { dbRef } from '../auth/constants';
import { ownCard } from './service';
import { applePayContext, decryptCardData, encryptCardData, providerScope, requireCards } from './settings';

/**
 * Apple Pay activation (same design as pingapp's `card.otp` flow). izipay delivers the issuer's one-time code as
 * a signed `card.otp` webhook carrying the provider card id, so nothing is armed at the provider and nothing is
 * polled from it. The latest code per card is kept AES-GCM encrypted in Redis until it expires; it never reaches
 * the database or logs.
 */
export const WINDOW_SEC = 600;
const codeKey = (cardId: string) => `cards:applepay:code:${providerScope()}:${cardId}`;
// Plaintext delivery time of the stored code, so a late retry never replaces a newer code.
const codeAtKey = (cardId: string) => `cards:applepay:code-at:${providerScope()}:${cardId}`;
// Clients may open a per-card waiting window before polling (no lock, no provider call).
const waitKey = (cardId: string) => `cards:applepay:wait:${providerScope()}:${cardId}`;

const deliverScript = `
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if current > tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[3])
return 1`;

export type ApplePayState = z.infer<typeof GetCardApplePayRes>;

const windowOf = (expiresAt: number) => ({
  expiresAt: new Date(expiresAt).toISOString(),
  expiresInSec: Math.max(0, Math.round((expiresAt - Date.now()) / 1000)),
});

async function applePayCard(userId: string, id: string) {
  const card = await ownCard(userId, id);
  requireCards();
  if (card.product !== 'mastercard')
    throw new AppError('CONFLICT', 'Apple Pay activation needs the Mastercard card type.', 409);
  if (card.status !== 'issued' || !card.providerCardId)
    throw new AppError('CONFLICT', 'Your card is not ready yet.', 409);
  return card;
}

async function deliveredCode(cardId: string): Promise<ApplePayState | null> {
  const raw = await getRedis().get(codeKey(cardId));
  if (!raw) return null;
  try {
    const { code, deliveredAt, expiresAt } = JSON.parse(decryptCardData(raw, applePayContext(cardId))) as {
      code: string;
      deliveredAt: number;
      expiresAt: number;
    };
    return expiresAt > Date.now()
      ? { status: 'delivered', code, receivedAt: new Date(deliveredAt).toISOString(), ...windowOf(expiresAt) }
      : null;
  } catch {
    return null;
  }
}

async function currentState(cardId: string): Promise<ApplePayState> {
  const delivered = await deliveredCode(cardId);
  if (delivered) return delivered;
  const waitUntil = Number(await getRedis().get(waitKey(cardId)));
  return waitUntil > Date.now() ? { status: 'waiting', ...windowOf(waitUntil) } : { status: 'idle' };
}

/** POST: opens a per-card waiting window (NX: a live window is joined, not extended). Nothing reaches izipay. */
export async function armApplePay(userId: string, id: string): Promise<ApplePayState> {
  const card = await applePayCard(userId, id);
  await getRedis().set(waitKey(card.id), String(Date.now() + WINDOW_SEC * 1000), 'EX', WINDOW_SEC, 'NX');
  return currentState(card.id);
}

/** GET: the stored code (armed or not) with a server-computed `expiresInSec`. */
export async function getApplePay(userId: string, id: string): Promise<ApplePayState> {
  const card = await applePayCard(userId, id);
  return currentState(card.id);
}

/**
 * `card.otp` webhook delivery. Stores the code for any known card of this provider scope, armed or not; the
 * lifetime is anchored to min(now, event time). Returns false for an unknown card, a malformed code or a
 * code that is already expired.
 */
export async function deliverOtp(event: {
  providerCardId: string;
  code: string;
  eventAt: string | null;
}): Promise<boolean> {
  if (!/^\d{4,10}$/.test(event.code)) return false;
  const [card] = await dbRef.db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.providerScope, providerScope()), eq(cards.providerCardId, event.providerCardId)))
    .limit(1);
  if (!card) return false;
  const deliveredAt = Math.min(Date.now(), event.eventAt ? new Date(event.eventAt).getTime() : Date.now());
  const expiresAt = deliveredAt + WINDOW_SEC * 1000;
  const ttl = Math.ceil((expiresAt - Date.now()) / 1000);
  if (ttl <= 0) return false;
  const sealed = encryptCardData(
    JSON.stringify({ code: event.code, deliveredAt, expiresAt }),
    applePayContext(card.id),
  );
  await getRedis().eval(
    deliverScript,
    2,
    codeKey(card.id),
    codeAtKey(card.id),
    String(deliveredAt),
    sealed,
    String(ttl),
  );
  return true;
}
