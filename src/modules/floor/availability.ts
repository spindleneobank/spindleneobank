import type { Redis } from 'ioredis';
import { config } from '../../config';
import { getRedis } from '../../lib/redis';

// Light module on purpose: the node hub imports it on its sweep path, so it must not pull in the epochs graph.
/** Mirrors availSettings.epochSeconds (kept separate so this module stays import-light; tests override). */
export const availSettings = { epochSeconds: config.EPOCH_SECONDS };
const AVAIL_TTL_S = 3 * 86_400;

export const availKey = (nodeId: string, epoch: bigint | number) => `floor:avail:${epoch}:${nodeId}`;

/** Records that `nodeId` was seen online at `ts` (one bit per minute of the epoch). */
export async function markAvailable(
  nodeId: string,
  ts: number | Date = Date.now(),
  redis: Redis = getRedis(),
): Promise<void> {
  const sec = Math.floor((typeof ts === 'number' ? ts : ts.getTime()) / 1000);
  const epoch = Math.floor(sec / availSettings.epochSeconds);
  const minute = Math.floor((sec % availSettings.epochSeconds) / 60);
  const key = availKey(nodeId, epoch);
  await redis.multi().setbit(key, minute, 1).expire(key, AVAIL_TTL_S).exec();
}

export async function onlineMinutes(
  nodeId: string,
  epoch: bigint,
  redis: Redis = getRedis(),
): Promise<number> {
  return redis.bitcount(availKey(nodeId, epoch));
}
