import { AppError } from '../../lib/errors';
import { getRedis } from '../../lib/redis';
import { identifier, parseProviderJson, record, sha256, signRequest } from './domain';
import { cardSettings, liveWritesBlocked, providerScope, requireCards } from './settings';

/** `not_sent` = nothing left this process; `rejected` = 4xx; `unknown` = outcome unknowable (429/5xx/timeout). */
export class ProviderError extends Error {
  constructor(
    public readonly outcome: 'not_sent' | 'rejected' | 'unknown',
    public readonly reason:
      | 'rate'
      | 'validation'
      | 'unavailable'
      | 'invalid_response'
      | 'writes_disabled' = 'unavailable',
  ) {
    super(`Card provider ${reason}`);
  }
}

export function liveWritesDisabledError(): AppError {
  return new AppError(
    'LIVE_WRITES_DISABLED',
    'Card issuing and top-ups are disabled in this environment (IZIPAY_LIVE_WRITES=false).',
    409,
  );
}

/** Refuses a mutating provider call in live mode while writes are off. Runs before any I/O. */
export function assertWritesAllowed(): void {
  if (liveWritesBlocked()) throw liveWritesDisabledError();
}

const redisPrefix = () => `cards:provider:${providerScope()}`;
export const providerRedisPrefix = redisPrefix;

const rateScript = `
local blocked = redis.call('EXISTS', KEYS[2])
if blocked == 1 then return 0 end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 60000)
local limit = tonumber(ARGV[2])
if limit == nil or limit <= 0 then limit = tonumber(redis.call('GET', KEYS[3]) or '24') end
if redis.call('ZCARD', KEYS[1]) >= limit then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 61000)
return 1`;

function endpoint(path: string): { url: string; signedPath: string } {
  const configured = cardSettings.baseUrl || 'https://izipay.me/api/v1';
  const base = new URL(configured);
  const prefix = base.pathname.replace(/\/+$/, '') || '/api/v1';
  // live mode talks only to izipay, and mock mode never does
  if ((cardSettings.mode === 'live') !== (base.origin === 'https://izipay.me')) {
    throw new ProviderError('not_sent', 'invalid_response');
  }
  return { url: `${base.origin}${prefix}${path}`, signedPath: `${prefix}${path}` };
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('unknown', 'invalid_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new ProviderError('unknown', 'invalid_response');
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function request(
  method: 'GET' | 'POST',
  path: string,
  body = '',
  idempotencyKey?: string,
): Promise<unknown> {
  requireCards();
  const redis = getRedis();
  const prefix = redisPrefix();
  let target: { url: string; signedPath: string };
  let timestamp: string;
  let signature: string;
  try {
    target = endpoint(path);
    timestamp = Math.floor(Date.now() / 1000).toString();
    signature = signRequest(cardSettings.apiSecret, timestamp, method, target.signedPath, body);
    const allowed = await redis.eval(
      rateScript,
      3,
      `${prefix}:budget`,
      `${prefix}:cooldown`,
      `${prefix}:limit`,
      crypto.randomUUID(),
      String(cardSettings.rateBudgetOverride ?? 0),
    );
    if (allowed !== 1) throw new ProviderError('not_sent', 'rate');
    // Never send the same signature twice (izipay rejects replays within the 5 minute window).
    if (!(await redis.set(`${prefix}:signature:${sha256(signature)}`, '1', 'EX', 305, 'NX'))) {
      throw new ProviderError('not_sent', 'rate');
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('not_sent');
  }
  try {
    const response = await fetch(target.url, {
      method,
      body: method === 'POST' ? body : undefined,
      headers: {
        authorization: `Bearer ${cardSettings.apiKey}`,
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-signature': signature,
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      },
      signal: AbortSignal.timeout(cardSettings.requestTimeoutMs),
      redirect: 'error',
    });
    if (response.status === 429) {
      await response.body?.cancel();
      await redis.set(`${prefix}:cooldown`, '1', 'EX', 60).catch(() => {});
      // An HTTP response to a mutation does not establish whether work was accepted.
      throw new ProviderError('unknown', 'rate');
    }
    if (!response.ok) {
      await response.body?.cancel();
      const rejected = [400, 401, 403, 404, 409, 422].includes(response.status);
      throw new ProviderError(
        rejected ? 'rejected' : 'unknown',
        response.status === 400 || response.status === 422 ? 'validation' : 'unavailable',
      );
    }
    const envelope = record(parseProviderJson(await readLimited(response)));
    if (envelope.success !== true || !('data' in envelope))
      throw new ProviderError('unknown', 'invalid_response');
    return envelope.data;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    // Never include fetch causes, raw response text, request bytes or secrets in errors.
    throw new ProviderError('unknown');
  }
}

function cardPath(id: string): string {
  if (!identifier(id)) throw new ProviderError('not_sent', 'invalid_response');
  return `/cards/${id}`;
}

export const provider = {
  /** Mutations: refused before any I/O while live writes are off. */
  issue(rawBody: string, key: string) {
    assertWritesAllowed();
    return request('POST', '/cards/issue', rawBody, key);
  },
  topup(id: string, rawBody: string, key: string) {
    assertWritesAllowed();
    return request('POST', `${cardPath(id)}/topup`, rawBody, key);
  },
  card: (id: string, live = false) => request('GET', cardPath(id) + (live ? '?live=1' : '')),
  cards: (page: number) => request('GET', `/cards?page=${page}&limit=100`),
  transactions: (id: string, offset: number) =>
    request('GET', `${cardPath(id)}/transactions?limit=100&offset=${offset}`),
  pricing: () => request('GET', '/balance'),
  /** Mock-only: marks an invoice paid (stands in for the on-chain payment). */
  sandboxConfirm(paymentId: string) {
    if (cardSettings.mode !== 'mock') throw new ProviderError('not_sent', 'invalid_response');
    return request('POST', '/sandbox/confirm', JSON.stringify({ payment_id: paymentId }));
  },
};
