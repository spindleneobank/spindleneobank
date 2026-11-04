import { config } from '../../config';
import type { JobModule } from '../../lib/modules';
import { activeCorpus } from './corpus';
import { scheduleCanaries } from './service';
import type { ShadowCheck } from './shadow';
import { runShadowCheck } from './shadow-job';

export const canaryJobs: JobModule = async (ctx) => {
  // canaries are the check on untrusted nodes: refuse to run production without them rather than stop checking
  if (config.NODE_ENV === 'production' && config.CANARY_RATE_BPS > 0 && !activeCorpus()) {
    throw new Error('CANARY_CORPUS_PATH must point at a readable private canary corpus');
  }
  ctx.process('canary', 'canary-dispatch', async () => {
    const sent = await scheduleCanaries();
    return { sent: sent.length };
  });
  ctx.process('canary', 'shadow-check', async (job) => ({
    result: await runShadowCheck(job.data as ShadowCheck),
  }));
  await ctx.schedule('canary', 'canary-dispatch', 60_000);
};

export default canaryJobs;
