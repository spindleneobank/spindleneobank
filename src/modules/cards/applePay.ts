import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cards } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { record, str } from './domain';
import { provider } from './provider';
import { ownCard } from './service';
import { applePayContext, decryptCardData, encryptCardData, providerScope, requireCards } from './settings';

/**
 * Apple Pay OTP capture. izipay matches the issuer's code email by timing only, so ONE card is armed at a
 * time across the whole provider account, for the full 10 minute window plus a 30 s margin. The code is held
 * AES-GCM encrypted in Redis until the window ends and never reaches the DB or logs.
 */
export const WINDOW_SEC = 600;
const LOCK_SEC = WINDOW_SEC + 30;
const lockKey = () => `cards:applepay:lock:${providerScope()}`;
const codeKey = (cardId: string) => `cards:applepay:code:${providerScope()}:${cardId}`;
const pollKey = (cardId: string) => `cards:applepay:poll:${providerScope()}:${cardId}`;

type Lock = { cardId: string; nonce: string; armedUntil: number };

const releaseScript =
  "local v = redis.call('GET', KEYS[1]) if v and cjson.decode(v).nonce == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

async function readLock(): Promise<Lock | null> {
  const raw = await getRedis().get(lockKey());
  if (!raw) return null;
  try {
    const lock = JSON.parse(raw) as Lock;
    return lock.armedUntil + 30_000 > Date.now() ? lock : null;
  } catch {
    return null;
  }
}

async function applePayCard(userId: string, id: string) {
  const card = await ownCard(userId, id);
  requireCards();
  if (card.product !== 'mastercard')
    throw new AppError('CONFLICT', 'Apple Pay activation needs the Mastercard card type.', 409);
  if (card.status !== 'issued' || !card.providerCardId)
    throw new AppError('CONFLICT', 'Your card is not ready yet.', 409);
  return card as typeof card & { providerCardId: string };
}

/** POST: arms capture. Another card holding the window answers 409 with `details.status = 'busy'`. */
export async function armApplePay(userId: string, id: string): Promise<{ armedUntil: string }> {
  const card = await applePayCard(userId, id);
  const redis = getRedis();
  const lock: Lock = { cardId: card.id, nonce: randomUUID(), armedUntil: Date.now() + WINDOW_SEC * 1000 };
  const acquired = await redis.set(lockKey(), JSON.stringify(lock), 'EX', LOCK_SEC, 'NX');
  if (!acquired) {
    const current = await readLock();
    if (current?.cardId === card.id) return { armedUntil: new Date(current.armedUntil).toISOString() };
    throw new AppError('CONFLICT', 'Another card is being activated. Try again in a few minutes.', 409, {
      status: 'busy',
    });
  }
  try {
    await provider.armApplePay(card.providerCardId);
  } catch (err) {
    await redis.eval(releaseScript, 1, lockKey(), lock.nonce).catch(() => {});
    if (err instanceof AppError) throw err;
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Could not start Apple Pay activation. Try again shortly.');
  }
  return { armedUntil: new Date(lock.armedUntil).toISOString() };
}

type State = { status: 'armed' | 'code' | 'expired' | 'busy'; code?: string; expiresAt: string | null };

async function storedCode(cardId: string): Promise<string | null> {
  const raw = await getRedis().get(codeKey(cardId));
  if (!raw) return null;
  try {
    return str(JSON.parse(decryptCardData(raw, applePayContext(cardId))).code, 12);
  } catch {
    return null;
  }
}

async function store(cardId: string, code: string, lock: Lock) {
  const ttl = Math.max(1, Math.ceil((lock.armedUntil + 30_000 - Date.now()) / 1000));
  await getRedis().set(
    codeKey(cardId),
    encryptCardData(JSON.stringify({ code }), applePayContext(cardId)),
    'EX',
    ttl,
  );
}

/** GET: the delivered code (if any), polling the provider at most once per 15 s while armed. */
export async function getApplePay(userId: string, id: string): Promise<State> {
  const card = await applePayCard(userId, id);
  const lock = await readLock();
  if (!lock) return { status: 'expired', expiresAt: null };
  if (lock.cardId !== card.id) return { status: 'busy', expiresAt: new Date(lock.armedUntil).toISOString() };
  const expiresAt = new Date(lock.armedUntil).toISOString();
  let code = await storedCode(card.id);
  if (
    !code &&
    Date.now() < lock.armedUntil &&
    (await getRedis().set(pollKey(card.id), '1', 'EX', 15, 'NX'))
  ) {
    try {
      const data = record(await provider.applePayCode(card.providerCardId));
      const polled = str(data.code, 12);
      if (data.status === 'delivered' && polled && /^\d{4,10}$/.test(polled)) {
        await store(card.id, polled, lock);
        code = polled;
      }
    } catch {
      /* the webhook is the primary path */
    }
  }
  if (code) return { status: 'code', code, expiresAt };
  return { status: Date.now() < lock.armedUntil ? 'armed' : 'expired', expiresAt };
}

/** `card.otp` webhook delivery. Stores only while this card holds the window; returns whether it was kept. */
export async function deliverOtp(event: { providerCardId: string; code: string }): Promise<boolean> {
  if (!/^\d{4,10}$/.test(event.code)) return false;
  const [card] = await dbRef.db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.providerCardId, event.providerCardId))
    .limit(1);
  if (!card) return false;
  const lock = await readLock();
  if (!lock || lock.cardId !== card.id) return false;
  await store(card.id, event.code, lock);
  return true;
}
