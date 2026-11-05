import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from 'hono/bun';
import { config } from '../config';
import { AppError } from './errors';
import type { Env } from './http';
import { getRedis } from './redis';

export type RateLimitOptions = {
  /** Bucket key (without prefix). Return an empty string to skip limiting. */
  key: (c: Context<Env>) => string;
  points: number;
  windowSec: number;
  /** Namespace so different limiters never share counters. */
  name?: string;
};

/** Fixed-window counter: INCR + EXPIRE in a MULTI. Returns the count and seconds until reset. */
export async function hit(key: string, windowSec: number): Promise<{ count: number; retryAfter: number }> {
  const redis = getRedis();
  const redisKey = `rl:${key}`;
  const res = await redis.multi().incr(redisKey).expire(redisKey, windowSec, 'NX').ttl(redisKey).exec();
  const count = Number(res?.[0]?.[1] ?? 0);
  const ttl = Number(res?.[2]?.[1] ?? windowSec);
  return { count, retryAfter: ttl > 0 ? ttl : windowSec };
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<Env> {
  const name = opts.name ?? `${opts.points}/${opts.windowSec}`;
  return async (c, next) => {
    const id = opts.key(c);
    if (id) {
      const { count, retryAfter } = await hit(`${name}:${id}`, opts.windowSec);
      if (count > opts.points) {
        c.header('retry-after', String(retryAfter));
        throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down.');
      }
    }
    await next();
  };
}

/** Loopback or a private range: the local tunnel, directly or through the Docker bridge. */
export function isPrivatePeer(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, '');
  return (
    ip === '::1' ||
    /^f[cd]/i.test(ip) ||
    /^(127|10)\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4)
  );
}

export const proxySettings = { trust: config.TRUST_PROXY };

/**
 * The client's IP. Proxy headers are only believed from a peer that can be our own proxy: anyone reaching the
 * origin directly could otherwise pick their own rate-limit bucket. Without a socket address (tests calling the
 * app directly) there is no peer to distrust.
 */
export function clientIp(c: Context): string {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    peer = undefined;
  }
  if (proxySettings.trust && (!peer || isPrivatePeer(peer))) {
    const cf = c.req.header('cf-connecting-ip')?.trim();
    if (cf) return cf;
    const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (xff) return xff;
  }
  return peer ?? 'unknown';
}

/**
 * What one client counts as for a limit: the address, or the /64 for IPv6. A single home connection gets a whole /64,
 * so limiting by full address would give it endless buckets.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(':') || ip.toLowerCase().startsWith('::ffff:')) return ip.replace(/^::ffff:/i, '');
  const [head = '', tail] = ip.toLowerCase().split('%')[0]?.split('::') ?? [];
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const groups = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return `${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, '0'))
    .join(':')}::/64`;
}

/** sha256(ip + daily salt). The raw IP is never stored. */
export function hashIp(ip: string, now = new Date()): string {
  return createHash('sha256')
    .update(`${ip}:${now.toISOString().slice(0, 10)}`)
    .digest('hex');
}

export const ipKey = (c: Context<Env>): string => hashIp(ipBucket(clientIp(c)));
