import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, not, sql } from 'drizzle-orm';
import { earningEvents, epochBalances, epochs } from '../../db/schema';
import { logger } from '../../lib/logger';
import { buildTree, treeToJson } from '../../shared/merkle';
import { dbRef } from '../auth/constants';
import { closedEpochAt, type EpochRow, epochEnd, treeFile, treePathOf, writeFileAtomic } from './service';
import { isHeldForX402, reverseUnpaidEarnings } from './x402-earnings';

export type BuildResult =
  | { kind: 'built'; epoch: bigint; root: string; totalEarned: bigint; owners: number }
  | { kind: 'exists'; row: EpochRow }
  | { kind: 'skipped'; reason: 'unchanged' | 'no-owners' };

export interface BuildOpts {
  /** Cap on totalEarned growth vs the base epoch (stepped posting after a cap failure). */
  maxIncrease?: bigint;
  now?: Date;
}

const bigMax = (a: bigint, b: bigint) => (a > b ? a : b);
const bigMin = (a: bigint, b: bigint) => (a < b ? a : b);
/** Held while epochs are built, so nothing else changes which events they contain. */
export const EPOCH_BUILD_LOCK = 80801;

/**
 * Epoch number to build at `now`: max(closed hour, highest existing epoch + 1), so a post-veto rebuild
 * (which had to skip past the vetoed number) never blocks the following hour.
 */
export async function nextEpochNumber(now: Date): Promise<bigint> {
  const closed = closedEpochAt(now);
  const [top] = await dbRef.db.select({ e: epochs.epoch }).from(epochs).orderBy(desc(epochs.epoch)).limit(1);
  return top && top.e + 1n > closed ? top.e + 1n : closed;
}

/**
 * Builds epoch `epoch`. Cumulatives are monotone: C_new(owner) = max(C_prev, sum of every assigned
 * event of the owner), so slash/withhold events are absorbed against future earnings and a posted
 * cumulative never decreases (an owner's claimed amount can never exceed a later cumulative).
 * Idempotent: an existing row for `epoch` is returned unchanged.
 */
export async function buildEpoch(epoch: bigint, opts: BuildOpts = {}): Promise<BuildResult> {
  const now = opts.now ?? new Date();
  const boundary = epochEnd(closedEpochAt(now)); // events strictly before the closed hour's end
  return dbRef.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${EPOCH_BUILD_LOCK})`);
    const [existing] = await tx.select().from(epochs).where(eq(epochs.epoch, epoch));
    if (existing) return { kind: 'exists', row: existing } as BuildResult;

    // Vetoed roots: their events go back into the pool.
    const vetoed = tx.select({ e: epochs.epoch }).from(epochs).where(eq(epochs.status, 'vetoed'));
    await tx
      .update(earningEvents)
      .set({ epoch: null })
      .where(and(isNotNull(earningEvents.epoch), inArray(earningEvents.epoch, vetoed)));

    await reverseUnpaidEarnings(tx);
    await tx
      .update(earningEvents)
      .set({ epoch })
      .where(and(isNull(earningEvents.epoch), lt(earningEvents.ts, boundary), not(isHeldForX402)));

    const [base] = await tx
      .select()
      .from(epochs)
      .where(ne(epochs.status, 'vetoed'))
      .orderBy(desc(epochs.epoch))
      .limit(1);
    const prev = new Map<string, bigint>();
    if (base) {
      const rows = await tx.select().from(epochBalances).where(eq(epochBalances.epoch, base.epoch));
      for (const r of rows) prev.set(r.owner, r.cumulativeUsdgMicros);
    }
    const sums = await tx
      .select({ owner: earningEvents.owner, s: sql<string>`sum(${earningEvents.usdgMicros})` })
      .from(earningEvents)
      .where(isNotNull(earningEvents.epoch))
      .groupBy(earningEvents.owner);
    const trueSum = new Map(sums.map((r) => [r.owner, BigInt(r.s)]));

    let remaining = opts.maxIncrease;
    const next = new Map<string, bigint>();
    let changed = false;
    for (const owner of [...new Set([...prev.keys(), ...trueSum.keys()])].sort()) {
      const p = prev.get(owner) ?? 0n;
      const t = trueSum.get(owner) ?? 0n;
      let c = bigMax(t, p);
      if (t < p)
        logger.info(
          { owner, prev: p.toString(), earned: t.toString() },
          'epoch: cumulative held (net penalty)',
        );
      if (remaining !== undefined && c > p) {
        const take = bigMin(c - p, remaining);
        remaining -= take;
        c = p + take;
      }
      if (c !== p) changed = true;
      if (c > 0n) next.set(owner, c);
    }
    const revert = async (reason: 'unchanged' | 'no-owners'): Promise<BuildResult> => {
      await tx.update(earningEvents).set({ epoch: null }).where(eq(earningEvents.epoch, epoch));
      return { kind: 'skipped', reason };
    };
    if (!changed) return revert('unchanged');
    if (next.size === 0) return revert('no-owners');

    const entries = [...next].map(([owner, cumulative]) => ({ owner: owner as `0x${string}`, cumulative }));
    const tree = buildTree(entries);
    const total = entries.reduce((a, e) => a + e.cumulative, 0n);
    const name = treeFile(epoch);
    await writeFileAtomic(treePathOf(name), JSON.stringify(treeToJson(tree)));

    const balanceRows = entries.map((e) => ({
      epoch,
      owner: e.owner,
      cumulativeUsdgMicros: e.cumulative,
    }));
    for (let i = 0; i < balanceRows.length; i += 1000)
      await tx.insert(epochBalances).values(balanceRows.slice(i, i + 1000));
    await tx.insert(epochs).values({
      epoch,
      root: tree.root,
      totalEarnedUsdgMicros: total,
      owners: entries.length,
      treePath: name,
      status: 'built',
    });
    logger.info({ epoch: epoch.toString(), root: tree.root, owners: entries.length }, 'epoch built');
    return { kind: 'built', epoch, root: tree.root, totalEarned: total, owners: entries.length };
  });
}
