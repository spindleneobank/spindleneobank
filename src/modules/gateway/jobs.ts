import type { JobModule } from '../../lib/modules';
import { reapStuckJobs } from './service';

export const gatewayJobs: JobModule = async (ctx) => {
  ctx.process('maintenance', 'gateway:reaper', async () => {
    const reaped = await reapStuckJobs();
    if (reaped > 0) ctx.logger.warn({ reaped }, 'gateway reaper released stuck jobs');
    return { reaped };
  });
  await ctx.schedule('maintenance', 'gateway:reaper', 60_000);
};

export default gatewayJobs;
