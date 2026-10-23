import { Redis } from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

/** BullMQ requires `maxRetriesPerRequest: null`. */
export function createRedis(): Redis {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  redis.on('error', (err) => logger.warn({ err: err.message }, 'redis connection error'));
  return redis;
}

let shared: Redis | undefined;
/** Shared app connection (lazy singleton). */
export function getRedis(): Redis {
  shared ??= createRedis();
  return shared;
}

export async function closeRedis(): Promise<void> {
  const r = shared;
  shared = undefined;
  if (r) await r.quit();
}
