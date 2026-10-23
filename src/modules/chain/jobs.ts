import type { JobModule } from '../../lib/modules';
import { computeKeeperState, KEEPER_KV_KEY, type KeeperState, type KvStore, pgKv } from './service';

/** One gas-monitor run: compute, log by level, persist to kv('keeper'). */
export async function runGasMonitor(
  log: {
    warn: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
    info: (o: object, m: string) => void;
  },
  kv: KvStore = pgKv,
  compute: typeof computeKeeperState = computeKeeperState,
) {
  const previous = (await kv.get(KEEPER_KV_KEY).catch(() => undefined)) as KeeperState | undefined;
  const state = await compute(new Date(), previous);
  const fields = { address: state.address, balanceWei: state.balanceWei, level: state.level };
  if (state.level === 'critical') log.error(fields, 'keeper balance critical: x402 disabled until refilled');
  else if (state.level === 'low') log.warn(fields, 'keeper balance low');
  else log.info(fields, 'keeper balance ok');
  await kv.set(KEEPER_KV_KEY, state);
  return state;
}

export const chainJobs: JobModule = async (ctx) => {
  ctx.process('chain', 'chain:gas-monitor', () => runGasMonitor(ctx.logger));
  await ctx.schedule('chain', 'chain:gas-monitor', 5 * 60_000);
};

export default chainJobs;
