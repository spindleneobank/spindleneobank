/**
 * The API-process side of canaries: what the gateway records about real traffic. Kept free of imports from
 * the canary service, which depends on the gateway.
 */
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { getQueue } from '../../lib/queue';
import { getRedis } from '../../lib/redis';
import type { BuyerShape } from './corpus';

export const shadowSettings = {
  /** Share of paid open-lane jobs re-run on the house node, in basis points. */
  rateBps: config.SHADOW_RATE_BPS,
  /** Off while reviewing real mismatches: results are stored, but nothing happens to the node. */
  enforce: config.SHADOW_ENFORCE,
  /** Sampled jobs are dropped rather than queued beyond this: the house node is a small CPU node. */
  maxWaiting: 20,
  /** A check holds the buyer's prompt and output in Redis until it runs, so oversized jobs are skipped. */
  maxPayloadBytes: 2 * 1024 * 1024,
  random: (): number => Math.random(),
};

export const SHAPES_KEY = 'canary:buyer-shapes';
const SHAPES_KEPT = 2000;

/** Remembers the shape of a buyer request, never its text, so canaries can match real traffic. */
export async function recordBuyerShape(shape: BuyerShape): Promise<void> {
  try {
    await getRedis()
      .multi()
      .lpush(SHAPES_KEY, JSON.stringify(shape))
      .ltrim(SHAPES_KEY, 0, SHAPES_KEPT)
      .exec();
  } catch (err) {
    logger.debug({ err: String(err) }, 'could not record buyer shape');
  }
}

export interface ShadowCheck {
  jobId: string;
  nodeId: string;
  model: string;
  kind: 'chat' | 'embeddings';
  /** The request as sent to the node. */
  body: Record<string, unknown>;
  outputText?: string;
  embeddings?: number[][];
}

/** Samples a finished job for re-execution in the worker. Never throws: it must not affect the buyer. */
export async function maybeEnqueueShadow(
  check: ShadowCheck,
  lane: string,
  isHouse: boolean,
): Promise<boolean> {
  try {
    if (lane !== 'open' || isHouse) return false; // sealed payloads are not visible; the house is the reference
    if (shadowSettings.random() * 10_000 >= shadowSettings.rateBps) return false;
    const payload = JSON.stringify(check);
    if (payload.length > shadowSettings.maxPayloadBytes) return false;
    const queue = getQueue('canary');
    if ((await queue.getWaitingCount()) >= shadowSettings.maxWaiting) return false;
    await queue.add('shadow-check', check, { attempts: 1, removeOnComplete: true, removeOnFail: true });
    return true;
  } catch (err) {
    logger.warn({ err: String(err), jobId: check.jobId }, 'could not enqueue shadow check');
    return false;
  }
}
