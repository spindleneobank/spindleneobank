import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from 'hono/bun';
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

/** cf-connecting-ip, then first x-forwarded-for entry, then the socket address. */
export function clientIp(c: Context): string {
  const cf = c.req.header('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** sha256(ip + daily salt). The raw IP is never stored. */
export function hashIp(ip: string, now = new Date()): string {
  return createHash('sha256')
    .update(`${ip}:${now.toISOString().slice(0, 10)}`)
    .digest('hex');
}

export const ipKey = (c: Context<Env>): string => hashIp(clientIp(c));
