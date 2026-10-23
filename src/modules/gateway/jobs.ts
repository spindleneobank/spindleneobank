import type { JobModule } from '../../lib/modules';
import { checkReservationConsistency, reapStuckJobs, reconcileTerminalAuths } from './service';

export const gatewayJobs: JobModule = async (ctx) => {
  ctx.process('maintenance', 'gateway:reaper', async () => {
    const reaped = await reapStuckJobs();
    if (reaped > 0) ctx.logger.warn({ reaped }, 'gateway reaper released stuck jobs');
    const reconciled = await reconcileTerminalAuths();
    if (reconciled > 0) ctx.logger.warn({ reconciled }, 'gateway reaper reconciled leaked reservations');
    const mismatches = (await checkReservationConsistency()).length;
    return { reaped, reconciled, mismatches };
  });
  await ctx.schedule('maintenance', 'gateway:reaper', 60_000);
};

export default gatewayJobs;
