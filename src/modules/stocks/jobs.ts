import type { JobModule } from '../../lib/modules';
import { reverifyAll } from './service';

const DAY_MS = 24 * 60 * 60_000;

export const stocksJobs: JobModule = async (ctx) => {
  ctx.process('maintenance', 'stocks:reverify', async () => {
    const r = await reverifyAll();
    ctx.logger.info(r, 'stocks reverify done');
    return r;
  });
  await ctx.schedule('maintenance', 'stocks:reverify', DAY_MS);
};

export default stocksJobs;
