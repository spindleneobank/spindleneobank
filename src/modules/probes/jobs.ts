import type { JobModule } from '../../lib/modules';
import { scheduleProbes } from './service';

export const probeJobs: JobModule = async (ctx) => {
  ctx.process('probes', 'probe-dispatch', async () => ({ probed: (await scheduleProbes()).length }));
  await ctx.schedule('probes', 'probe-dispatch', 5 * 60_000);
};

export default probeJobs;
