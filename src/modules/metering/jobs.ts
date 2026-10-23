import { and, eq, lt, sql } from 'drizzle-orm';
import { jobs, receipts } from '../../db/schema';
import type { JobModule } from '../../lib/modules';
import { dbRef } from '../auth/constants';

/** Completed jobs with no receipt row after this long mean the verify hand-off failed. */
const UNRECEIPTED_AFTER_MS = 10 * 60_000;

/** Counts completed paid jobs that never got a receipt row (verifier crashed / hand-off lost). */
export async function countUnreceipted(now = Date.now()): Promise<number> {
  const rows = await dbRef.db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'completed'),
        lt(jobs.finishedAt, new Date(now - UNRECEIPTED_AFTER_MS)),
        sql`not exists (select 1 from ${receipts} where ${receipts.jobId} = ${jobs.id})`,
      ),
    );
  return rows[0]?.n ?? 0;
}

export const meteringJobs: JobModule = async (ctx) => {
  ctx.process('metering', 'metering:unreceipted', async () => {
    const n = await countUnreceipted();
    if (n > 0) ctx.logger.error({ unreceipted: n }, 'completed jobs without a receipt row');
    return { unreceipted: n };
  });
  await ctx.schedule('metering', 'metering:unreceipted', 5 * 60_000);
};

export default meteringJobs;
