import type { JobModule } from '../../lib/modules';
import { scheduleCanaries } from './service';

export const canaryJobs: JobModule = async (ctx) => {
  ctx.process('canary', 'canary-dispatch', async () => {
    const sent = await scheduleCanaries();
    return { sent: sent.length };
  });
  await ctx.schedule('canary', 'canary-dispatch', 60_000);
};

export default canaryJobs;
