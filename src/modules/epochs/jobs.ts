import { eq } from 'drizzle-orm';
import { epochs, kv } from '../../db/schema';
import type { JobModule } from '../../lib/modules';
import { getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { buildEpoch, nextEpochNumber } from './builder';
import { type PostOutcome, postPending } from './poster';
import { epochSettings } from './service';

export const LOCK_KEY = 'lock:epoch';
/** kv: last epoch number the builder ran for, so a skipped (unchanged) hour is not recomputed every minute. */
export const ATTEMPT_KEY = 'epoch:build-attempt';
const LOCK_TTL_S = 300;
/** Build starts this far into the new hour (late receipts for the closed hour get a couple of minutes). */
export const BUILD_DELAY_S = 120;

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export type EpochRunResult = {
  skipped?: 'locked';
  build?: string;
  post?: PostOutcome | { kind: 'error'; error: string };
};

/** One pass: build the closed hour (minute 2+), then post whatever is pending. Idempotent. */
export async function runEpochOnce(now = new Date()): Promise<EpochRunResult> {
  const redis = getRedis();
  const token = crypto.randomUUID();
  if ((await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_S, 'NX')) !== 'OK') return { skipped: 'locked' };
  try {
    const out: EpochRunResult = {};
    const secIntoHour = Math.floor(now.getTime() / 1000) % epochSettings.epochSeconds;
    if (secIntoHour >= BUILD_DELAY_S) {
      const target = await nextEpochNumber(now);
      const [att] = await dbRef.db.select().from(kv).where(eq(kv.key, ATTEMPT_KEY));
      if ((att?.value as { epoch?: string } | undefined)?.epoch === target.toString()) {
        out.build = 'attempted';
      } else {
        const r = await buildEpoch(target, { now });
        out.build = r.kind === 'skipped' ? `skipped:${r.reason}` : r.kind;
        const value = { epoch: target.toString() };
        await dbRef.db
          .insert(kv)
          .values({ key: ATTEMPT_KEY, value })
          .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });
      }
    }
    try {
      out.post = await postPending();
    } catch (err) {
      out.post = { kind: 'error', error: err instanceof Error ? err.message : String(err) };
    }
    return out;
  } finally {
    await redis.eval(RELEASE, 1, LOCK_KEY, token).catch(() => undefined);
  }
}

/** Epochs currently stuck (admin visibility). */
export async function pendingEpochs() {
  return dbRef.db.select().from(epochs).where(eq(epochs.status, 'posting'));
}

export const epochJobs: JobModule = async (ctx) => {
  ctx.process('epoch', 'epoch:run', async () => {
    const res = await runEpochOnce();
    if (res.post?.kind === 'error') ctx.logger.error({ error: res.post.error }, 'epoch post errored');
    return res;
  });
  await ctx.schedule('epoch', 'epoch:run', 60_000);
};

export default epochJobs;
