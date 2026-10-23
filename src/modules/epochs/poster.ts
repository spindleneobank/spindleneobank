import { erc20Abi, spindleClaimsAbi } from '@spindle/shared/abi';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import { config } from '../../config';
import { auditLog, epochs, kv } from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { type KeeperTxInput, type KeeperTxResult, keeperAccount, sendKeeperTx } from '../../lib/keeper';
import { logger } from '../../lib/logger';
import { publicClient } from '../../lib/viem';
import { dbRef } from '../auth/constants';
import type { EpochRow } from './service';

export type OnchainRoot = { root: Hex; totalEarned: bigint; postedAt: bigint };

/** Everything the poster reads from the chain (injectable). */
export interface PosterChain {
  maxPostedEpoch(): Promise<bigint>;
  lastEpoch(): Promise<bigint>;
  root(epoch: bigint): Promise<OnchainRoot>;
  maxEpochIncrease(): Promise<bigint>;
  /** USDG.balanceOf(claims) */
  poolBalance(): Promise<bigint>;
  totalClaimed(): Promise<bigint>;
  keeperEth(): Promise<bigint>;
  /** null = not found (yet) */
  receiptStatus(hash: Hex): Promise<'success' | 'reverted' | null>;
}

export interface PosterDeps {
  chain: PosterChain;
  send(input: KeeperTxInput): Promise<KeeperTxResult>;
  claims: Address;
  criticalEthWei: bigint;
  now(): Date;
}

export const ALERT_KEY = 'epoch:alert';
/** A `posting` epoch whose tx never shows up and whose root is not on chain is re-armed after this long. */
export const POSTING_STALE_MS = 15 * 60_000;

export function defaultPosterDeps(): PosterDeps {
  const claims = requireAddress('claims');
  const usdg = requireAddress('usdg');
  const read = <T>(functionName: string, args: unknown[] = []) =>
    publicClient.readContract({
      address: claims,
      abi: spindleClaimsAbi,
      functionName,
      args,
    } as never) as Promise<T>;
  return {
    claims,
    criticalEthWei: BigInt(config.KEEPER_CRITICAL_ETH_WEI),
    now: () => new Date(),
    send: sendKeeperTx,
    chain: {
      maxPostedEpoch: () => read<bigint>('maxPostedEpoch'),
      lastEpoch: () => read<bigint>('lastEpoch'),
      async root(epoch) {
        const r = await read<readonly [Hex, bigint, bigint, boolean]>('roots', [epoch]);
        return { root: r[0], totalEarned: r[1], postedAt: r[2] };
      },
      maxEpochIncrease: () => read<bigint>('maxEpochIncrease'),
      poolBalance: () =>
        publicClient.readContract({
          address: usdg,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [claims],
        }) as Promise<bigint>,
      totalClaimed: () => read<bigint>('totalClaimed'),
      keeperEth: () => publicClient.getBalance({ address: keeperAccount().address }),
      async receiptStatus(hash) {
        try {
          return (await publicClient.getTransactionReceipt({ hash })).status;
        } catch {
          return null;
        }
      },
    },
  };
}

export type PostOutcome =
  | { kind: 'posted'; epoch: bigint; txHash: Hex; gasUsed?: bigint }
  | { kind: 'posting'; epoch: bigint; txHash: Hex | null }
  | { kind: 'failed'; epoch: bigint; reason: string }
  | { kind: 'noop'; reason: string };

/**
 * Admin-visible alert: structured error log always; audit_log row and the `epoch:alert` kv entry once per
 * (epoch, reason) so a retrying job does not flood them.
 */
export async function raiseEpochAlert(epoch: bigint, reason: string, extra: Record<string, unknown> = {}) {
  const details = { epoch: epoch.toString(), reason, ...extra };
  logger.error(details, 'epoch post blocked');
  const db = dbRef.db;
  const [cur] = await db.select().from(kv).where(eq(kv.key, ALERT_KEY));
  const prev = cur?.value as { epoch?: string; reason?: string } | undefined;
  if (prev?.epoch === details.epoch && prev?.reason === reason) return;
  await db.insert(auditLog).values({
    actor: 'system:epoch-poster',
    action: 'epoch.post_failed',
    subject: details.epoch,
    details,
  });
  const value = { ...details, at: new Date().toISOString() };
  await db
    .insert(kv)
    .values({ key: ALERT_KEY, value })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });
}

async function setStatus(epoch: bigint, from: string[], set: Partial<typeof epochs.$inferInsert>) {
  await dbRef.db
    .update(epochs)
    .set(set)
    .where(and(eq(epochs.epoch, epoch), inArray(epochs.status, from)));
}

async function fail(
  epoch: bigint,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<PostOutcome> {
  await setStatus(epoch, ['built', 'posting', 'failed'], { status: 'failed' });
  await raiseEpochAlert(epoch, reason, extra);
  return { kind: 'failed', epoch, reason };
}

/** Resolves a `posting` epoch by reading the chain. Re-arms (never blindly re-sends) only when the tx is gone. */
export async function reconcilePosting(row: EpochRow, deps: PosterDeps): Promise<PostOutcome> {
  const onchain = await deps.chain.root(row.epoch);
  if (onchain.postedAt > 0n) {
    if (onchain.root.toLowerCase() === row.root.toLowerCase()) {
      await setStatus(row.epoch, ['posting', 'built', 'failed'], {
        status: 'posted',
        postedAt: new Date(Number(onchain.postedAt) * 1000),
      });
      return { kind: 'posted', epoch: row.epoch, txHash: (row.txHash ?? '0x') as Hex };
    }
    return fail(row.epoch, 'onchain root differs from built root', {
      onchain: onchain.root,
      built: row.root,
    });
  }
  const st = row.txHash ? await deps.chain.receiptStatus(row.txHash as Hex) : null;
  if (st === 'reverted') return fail(row.epoch, 'postRoot reverted', { txHash: row.txHash });
  if (st === null && deps.now().getTime() - row.builtAt.getTime() > POSTING_STALE_MS) {
    await setStatus(row.epoch, ['posting'], { status: 'built', txHash: null });
    logger.warn({ epoch: row.epoch.toString() }, 'posting epoch has no tx receipt and no root; re-armed');
  }
  return { kind: 'posting', epoch: row.epoch, txHash: (row.txHash as Hex | null) ?? null };
}

/** Prechecks then postRoot. Never sends when a precheck fails. */
export async function postEpoch(epoch: bigint, deps: PosterDeps = defaultPosterDeps()): Promise<PostOutcome> {
  const [row] = await dbRef.db.select().from(epochs).where(eq(epochs.epoch, epoch));
  if (!row) return { kind: 'noop', reason: 'unknown epoch' };
  if (row.status === 'posted' || row.status === 'vetoed') return { kind: 'noop', reason: row.status };
  if (row.status === 'posting') return reconcilePosting(row, deps);

  const c = deps.chain;
  let pre: { maxPosted: bigint; prevTotal: bigint; cap: bigint; pool: bigint; claimed: bigint; eth: bigint };
  try {
    const [maxPosted, last, cap, pool, claimed, eth] = await Promise.all([
      c.maxPostedEpoch(),
      c.lastEpoch(),
      c.maxEpochIncrease(),
      c.poolBalance(),
      c.totalClaimed(),
      c.keeperEth(),
    ]);
    const prevTotal = last === 0n ? 0n : (await c.root(last)).totalEarned;
    pre = { maxPosted, prevTotal, cap, pool, claimed, eth };
  } catch (err) {
    // Cannot verify -> do not post. Status unchanged, next run retries.
    logger.error(
      { epoch: epoch.toString(), err: err instanceof Error ? err.message : String(err) },
      'epoch precheck read failed',
    );
    return { kind: 'noop', reason: 'chain read failed' };
  }
  const total = row.totalEarnedUsdgMicros;
  const info = {
    totalEarned: total.toString(),
    prevTotal: pre.prevTotal.toString(),
    cap: pre.cap.toString(),
    pool: pre.pool.toString(),
    totalClaimed: pre.claimed.toString(),
    maxPosted: pre.maxPosted.toString(),
  };
  if (epoch <= pre.maxPosted) return fail(epoch, 'epoch not above maxPostedEpoch', info);
  if (total < pre.prevTotal) return fail(epoch, 'totalEarned below previous root', info);
  if (total - pre.prevTotal > pre.cap) return fail(epoch, 'maxEpochIncrease exceeded; post in steps', info);
  const owed = total - pre.claimed;
  if (pre.pool < owed)
    return fail(epoch, 'insolvent: claims pool below owed', {
      ...info,
      owed: owed.toString(),
      shortfall: (owed - pre.pool).toString(),
    });
  if (pre.eth < deps.criticalEthWei)
    return fail(epoch, 'keeper ETH below critical', { ...info, keeperEth: pre.eth.toString() });

  await setStatus(epoch, ['built', 'failed'], { status: 'posting' });
  const data = encodeFunctionData({
    abi: spindleClaimsAbi,
    functionName: 'postRoot',
    args: [epoch, row.root as Hex, total],
  });
  let res: KeeperTxResult;
  try {
    res = await deps.send({ to: deps.claims, data, label: `postRoot:${epoch}` });
  } catch (err) {
    // Node definitively rejected the tx (nothing broadcast): safe to retry later.
    await setStatus(epoch, ['posting'], { status: 'built' });
    await raiseEpochAlert(epoch, 'keeper send rejected', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'failed', epoch, reason: 'keeper send rejected' };
  }
  if (res.status === 'success') {
    // If the indexer raced us it already set posted/postedAt; the status guard keeps its values.
    await setStatus(epoch, ['posting'], { status: 'posted', txHash: res.hash, postedAt: deps.now() });
    logger.info({ epoch: epoch.toString(), hash: res.hash, gasUsed: res.gasUsed.toString() }, 'root posted');
    return { kind: 'posted', epoch, txHash: res.hash, gasUsed: res.gasUsed };
  }
  if (res.status === 'reverted') {
    await dbRef.db.update(epochs).set({ txHash: res.hash }).where(eq(epochs.epoch, epoch));
    return fail(epoch, 'postRoot reverted', { txHash: res.hash });
  }
  await setStatus(epoch, ['posting'], { txHash: res.hash });
  logger.warn({ epoch: epoch.toString(), hash: res.hash }, 'postRoot outcome unknown; epoch stays posting');
  return { kind: 'posting', epoch, txHash: res.hash };
}

/**
 * Posts the newest pending epoch. Older built/failed ones are superseded: the contract needs ascending epochs
 * and every newer tree already contains their balances. Failed epochs that have a tx hash (reverted) are not retried.
 */
export async function postPending(deps: PosterDeps = defaultPosterDeps()): Promise<PostOutcome> {
  const [head] = await dbRef.db
    .select()
    .from(epochs)
    .where(inArray(epochs.status, ['built', 'posting', 'failed']))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  if (!head) return { kind: 'noop', reason: 'nothing pending' };
  const [newer] = await dbRef.db
    .select({ e: epochs.epoch })
    .from(epochs)
    .where(eq(epochs.status, 'posted'))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  if (newer && newer.e > head.epoch) return { kind: 'noop', reason: 'superseded' };
  if (head.status === 'failed' && head.txHash) return { kind: 'noop', reason: 'failed after broadcast' };
  return postEpoch(head.epoch, deps);
}
