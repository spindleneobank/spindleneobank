import type { JobModule } from '../../lib/modules';
import { rolloverRateCard } from './service';

const TEN_MINUTES = 10 * 60_000;

/**
 * Daily rollover (copy tomorrow from today when missing). Runs every 10 minutes because the queue
 * scheduler is interval based; the work is an idempotent insert-if-missing, normally a no-op.
 * The first run after 00:05 UTC at the latest keeps tomorrow's card ahead of the day change.
 */
export const ratesJobs: JobModule = async (ctx) => {
  ctx.process('maintenance', 'rates:rollover', async () => {
    const r = await rolloverRateCard();
    if (r.today > 0 || r.tomorrow > 0) ctx.logger.info(r, 'rate card rows created');
    return r;
  });
  await ctx.schedule('maintenance', 'rates:rollover', TEN_MINUTES);
};

export default ratesJobs;
