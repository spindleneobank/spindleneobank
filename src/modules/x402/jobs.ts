import type { JobModule } from '../../lib/modules';
import { runKeeperGuard } from './guard';
import './provider';
import { runSettle } from './settle';
import { refreshSurcharge } from './surcharge';

export const SETTLE_EVERY_MS = 10 * 60_000;
export const GUARD_EVERY_MS = 5 * 60_000;
export const SURCHARGE_EVERY_MS = 5 * 60_000;

export const x402Jobs: JobModule = async (ctx) => {
  ctx.process('x402', 'x402-settle', async () => {
    const r = await runSettle();
    if (r.settled || r.failed || r.expired || r.requeued) ctx.logger.info(r, 'x402 settle run');
    return r;
  });
  ctx.process('x402', 'x402-guard', () => runKeeperGuard());
  ctx.process('x402', 'x402-surcharge', async () => {
    const r = await refreshSurcharge();
    if (r.surchargeMicros === null) ctx.logger.warn({}, 'x402 surcharge unknown: ETH price unavailable');
    return r;
  });
  await ctx.schedule('x402', 'x402-settle', SETTLE_EVERY_MS);
  await ctx.schedule('x402', 'x402-guard', GUARD_EVERY_MS);
  await ctx.schedule('x402', 'x402-surcharge', SURCHARGE_EVERY_MS);
};

export default x402Jobs;
