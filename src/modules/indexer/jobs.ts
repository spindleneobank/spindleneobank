import type { JobModule } from '../../lib/modules';
import { runIndexOnce } from './indexer';

export const indexerJobs: JobModule = async (ctx) => {
  ctx.process('chain', 'indexer', async () => {
    const res = await runIndexOnce();
    return res;
  });
  await ctx.schedule('chain', 'indexer', 15_000);
};

export default indexerJobs;
