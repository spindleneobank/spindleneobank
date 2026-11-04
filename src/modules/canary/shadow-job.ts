/**
 * Worker side of shadow re-execution: a sampled paid job is replayed on the house node and the node's output
 * compared with it. The node saw an ordinary buyer job, so unlike a canary this cannot be recognised at all.
 * A mismatch is recorded as a canary failure; an inconclusive comparison is not recorded. Results hold
 * cosines only, never the buyer's text, and the replay itself is free (no job row, no charge, no earning).
 */
import { eq } from 'drizzle-orm';
import { jobs, nodes, receipts } from '../../db/schema';
import { logger } from '../../lib/logger';
import { dbRef } from '../auth/constants';
import { loadCatalog } from '../nodes/service';
import { compareChatWithHouse, compareSettings, type HouseVerdict, houseEmbed } from './compare';
import { EMBEDDING_COSINE_MIN, evaluateEmbeddings, recordCanaryResult } from './service';
import type { ShadowCheck } from './shadow';

async function compareEmbeddings(check: ShadowCheck): Promise<HouseVerdict> {
  const model = (await loadCatalog()).find((m) => m.id === check.model);
  const { input } = check.body;
  const inputs = Array.isArray(input) ? (input as string[]) : [input as string];
  try {
    const refs = model ? await houseEmbed(model, inputs) : null;
    if (!refs) return { verdict: 'inconclusive', reason: 'house node cannot embed this' };
    const r = evaluateEmbeddings(refs, check.embeddings ?? []);
    return { verdict: r.pass ? 'match' : 'mismatch', cosine: r.minCosine, houseSelf: 1 };
  } catch (err) {
    return { verdict: 'inconclusive', reason: String(err) };
  }
}

/** Returns what was decided; only `match` and `mismatch` are recorded. */
export async function runShadowCheck(check: ShadowCheck): Promise<HouseVerdict['verdict'] | 'skipped'> {
  const [row] = await dbRef.db
    .select({ job: jobs, isHouse: nodes.isHouse, verified: receipts.verified })
    .from(jobs)
    .innerJoin(nodes, eq(nodes.id, jobs.nodeId))
    .innerJoin(receipts, eq(receipts.jobId, jobs.id))
    .where(eq(jobs.id, check.jobId));
  // only paid jobs with a good receipt: a bad receipt is already handled, and earned nothing
  if (!row?.verified || row.isHouse || row.job.buyerUsdgMicros <= 0n) return 'skipped';

  let result: HouseVerdict;
  if (check.kind === 'embeddings') result = await compareEmbeddings(check);
  else {
    const model = (await loadCatalog()).find((m) => m.id === check.model);
    result = model
      ? await compareChatWithHouse(model, check.body, check.outputText ?? '')
      : { verdict: 'inconclusive', reason: 'model not in catalog' };
  }
  if (result.verdict === 'inconclusive') {
    logger.info({ jobId: check.jobId, reason: result.reason }, 'shadow check inconclusive; not counted');
    return 'inconclusive';
  }
  await recordCanaryResult({
    nodeId: check.nodeId,
    jobId: check.jobId,
    kind: 'shadow',
    expected: {
      model: check.model,
      minCosine: check.kind === 'chat' ? compareSettings.chatCosineMin : EMBEDDING_COSINE_MIN,
    },
    observed: { cosine: result.cosine, houseSelf: result.houseSelf },
    pass: result.verdict === 'match',
  });
  return result.verdict;
}
