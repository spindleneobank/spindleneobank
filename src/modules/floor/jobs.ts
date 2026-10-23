import type { JobModule } from '../../lib/modules';
import { applyClosedFloor } from './service';

export const FLOOR_EVERY_MS = 60_000;

/**
 * Runs every minute on the epoch queue: pays the floor for the hour that just closed. The epoch builder starts
 * 2 minutes into the hour, so the floor events are in place before cumulatives are computed. Idempotent.
 */
export const floorJobs: JobModule = async (ctx) => {
  ctx.process('epoch', 'floor:apply', async () => {
    const r = await applyClosedFloor();
    if (r.kind === 'paid') ctx.logger.info({ nodes: r.nodes, paid: r.paidMicros.toString() }, 'floor paid');
    return JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  });
  await ctx.schedule('epoch', 'floor:apply', FLOOR_EVERY_MS);
};

export default floorJobs;
