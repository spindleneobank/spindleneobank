import type { JobModule } from '../../lib/modules';
import { refreshEmbeddingReferences, scheduleCanaries } from './service';

export const canaryJobs: JobModule = async (ctx) => {
  ctx.process('canary', 'canary-dispatch', async () => {
    const sent = await scheduleCanaries();
    return { sent: sent.length };
  });
  ctx.process('canary', 'canary-embeddings-refresh', async () => ({
    refreshed: await refreshEmbeddingReferences(),
  }));
  await ctx.schedule('canary', 'canary-dispatch', 60_000);
  await ctx.schedule('canary', 'canary-embeddings-refresh', 15 * 60_000);
};

export default canaryJobs;
