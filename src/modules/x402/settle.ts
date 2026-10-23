import { buyerVaultAbi } from '@spindle/shared/abi';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { type Address, encodeFunctionData, type Hex, parseEventLogs, type TransactionReceipt } from 'viem';
import { config } from '../../config';
import { x402Payments } from '../../db/schema';
import type { X402Payment } from '../../db/types';
import { requireAddress } from '../../lib/contracts';
import { type KeeperTxInput, type KeeperTxResult, keeperBalance, sendKeeperTx } from '../../lib/keeper';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { publicClient } from '../../lib/viem';
import { dbRef } from '../auth/constants';
import { CLOSING_COUNTER, closeSession, sessionExpiresAt } from './sessions';
import { BARRED_KEY, chainDeps } from './verify';

export const BATCH_SIZE = 25;
/** Payments whose Permit2 deadline is nearer than this are settled first. */
export const URGENT_SEC = 15 * 60;
/** A payment this close to its deadline can no longer be settled safely. */
export const EXPIRY_MARGIN_SEC = 60;
const SETTLE_LOCK = 'x402:settle-lock';
const MAX_REVERTS = 3;
const STUCK_SEC = 300;
const DROPPED_SEC = 1800;

export type SettleDeps = {
  now: () => number; // unix seconds
  redis: () => Redis;
  send: (input: KeeperTxInput) => Promise<KeeperTxResult>;
  receipt: (hash: Hex) => Promise<TransactionReceipt | null>;
  /** False only when the chain positively does not know the tx (dropped); RPC errors count as known. */
  txKnown: (hash: Hex) => Promise<boolean>;
  nonceUsed: (payer: Address, nonce: bigint) => Promise<boolean>;
  keeperBalanceWei: () => Promise<bigint>;
  vault: () => Address;
};

export const defaultSettleDeps: SettleDeps = {
  now: () => Math.floor(Date.now() / 1000),
  redis: getRedis,
  send: sendKeeperTx,
  receipt: (hash) => publicClient.getTransactionReceipt({ hash }).catch(() => null),
  txKnown: async (hash) => {
    try {
      await publicClient.getTransaction({ hash });
      return true;
    } catch (err) {
      return !(err instanceof Error && err.name === 'TransactionNotFoundError');
    }
  },
  nonceUsed: (p, n) => chainDeps.nonceUsed(p, n),
  keeperBalanceWei: keeperBalance,
  vault: () => requireAddress('vault'),
};

export function toSettlement(r: X402Payment) {
  return {
    permit: {
      permitted: {
        token: (r.permit as { permitted: { token: Address } }).permitted.token,
        amount: r.capMicros as bigint,
      },
      nonce: BigInt(r.nonce as string),
      deadline: r.deadline as bigint,
    },
    payer: r.payer as Address,
    paymentId: r.paymentId as Hex,
    surcharge: r.surchargeMicros as bigint,
    validAfter: r.validAfter as bigint,
    used: r.usedMicros,
    signature: r.signature as Hex,
  };
}

export type SettleSummary = {
  skipped?: string;
  expired: number;
  settled: number;
  failed: number;
  requeued: number;
  txHash?: Hex;
};

/** Unsettled payments past their deadline, or session TTLs that elapsed. */
async function sweep(deps: SettleDeps): Promise<number> {
  const now = deps.now();
  // sessions past their TTL stop accepting requests
  const open = await dbRef.db
    .select()
    .from(x402Payments)
    .where(and(eq(x402Payments.scheme, 'session'), eq(x402Payments.status, 'open')));
  for (const s of open)
    if (sessionExpiresAt(s) > 0 && sessionExpiresAt(s) <= now) await closeSession(s.id, deps.redis());
  // anything whose permit can no longer be used is a loss bounded by the exposure cap
  const expired = await dbRef.db
    .update(x402Payments)
    .set({ status: 'expired', closedAt: new Date(now * 1000) })
    .where(
      and(
        inArray(x402Payments.status, ['open', 'closing']),
        lt(x402Payments.deadline, BigInt(now + EXPIRY_MARGIN_SEC)),
      ),
    )
    .returning({ id: x402Payments.id });
  // closing with nothing to charge: nothing to settle
  const unused = await dbRef.db
    .update(x402Payments)
    .set({ status: 'expired', closedAt: new Date(now * 1000) })
    .where(
      and(
        eq(x402Payments.status, 'closing'),
        eq(x402Payments.usedMicros, 0n),
        eq(x402Payments.reservedMicros, 0n),
      ),
    )
    .returning({ id: x402Payments.id });
  return expired.length + unused.length;
}

/** `settling` rows left behind by a crash or an unknown tx outcome. */
async function reconcileSettling(deps: SettleDeps): Promise<void> {
  const rows = await dbRef.db.select().from(x402Payments).where(eq(x402Payments.status, 'settling'));
  const cutoff = (deps.now() - STUCK_SEC) * 1000;
  for (const r of rows) {
    if ((r.closedAt?.getTime() ?? 0) > cutoff) continue; // closedAt doubles as "claimed at" while settling
    if (r.settleTx) {
      const rc = await deps.receipt(r.settleTx as Hex);
      if (rc) {
        await applyReceipt([r], rc, deps);
        continue;
      }
      // No receipt. After 30 min, a tx the chain does not know at all was dropped: re-queue (the Permit2 nonce
      // prevents a double spend). A pending/known tx keeps waiting; we never re-send while it may still land.
      if (
        (r.closedAt?.getTime() ?? 0) <= (deps.now() - DROPPED_SEC) * 1000 &&
        !(await deps.txKnown(r.settleTx as Hex))
      ) {
        await dbRef.db.update(x402Payments).set({ settleTx: null }).where(eq(x402Payments.id, r.id));
        await requeue([r.id], deps);
      }
      continue;
    }
    // claimed but never sent (crash) or send outcome unknown: if the nonce is spent the indexer will deliver the event
    const spent = await deps.nonceUsed(r.payer as Address, BigInt(r.nonce as string)).catch(() => true);
    if (!spent) await requeue([r.id], deps);
  }
}

async function requeue(ids: string[], _deps: SettleDeps): Promise<void> {
  if (ids.length === 0) return;
  await dbRef.db
    .update(x402Payments)
    .set({ status: 'closing', settleTx: null })
    .where(and(inArray(x402Payments.id, ids), eq(x402Payments.status, 'settling')));
}

async function bar(payer: string, deps: SettleDeps): Promise<void> {
  await deps.redis().sadd(BARRED_KEY, payer.toLowerCase());
}

/** Apply Settled / SettleFailed logs of a mined tx (the indexer applies the same events idempotently). */
export async function applyReceipt(
  rows: X402Payment[],
  rc: TransactionReceipt,
  deps: SettleDeps,
): Promise<{ settled: number; failed: number; requeued: number }> {
  const out = { settled: 0, failed: 0, requeued: 0 };
  const byId = new Map(rows.map((r) => [r.paymentId.toLowerCase(), r]));
  const logs = parseEventLogs({
    abi: buyerVaultAbi,
    logs: rc.logs,
    eventName: ['Settled', 'SettleFailed'],
  }).filter((l) => l.address.toLowerCase() === deps.vault().toLowerCase());
  const seen = new Set<string>();
  for (const l of logs) {
    const args = l.args as { paymentId: Hex; payer: Address; used?: bigint; reason?: Hex };
    const row = byId.get(args.paymentId.toLowerCase());
    if (!row) continue;
    seen.add(row.id);
    if (l.eventName === 'Settled') {
      await dbRef.db
        .update(x402Payments)
        .set({
          status: 'settled',
          usedMicros: args.used ?? row.usedMicros,
          settleTx: rc.transactionHash,
          closedAt: new Date(),
        })
        .where(and(eq(x402Payments.id, row.id), eq(x402Payments.status, 'settling')));
      out.settled++;
    } else {
      const upd = await dbRef.db
        .update(x402Payments)
        .set({
          status: 'failed',
          failReason: String(args.reason ?? '').toLowerCase(),
          settleTx: rc.transactionHash,
          closedAt: new Date(),
        })
        .where(and(eq(x402Payments.id, row.id), eq(x402Payments.status, 'settling')))
        .returning({ id: x402Payments.id });
      // never bar a payer whose payment was already settled (indexer got there first)
      if (upd.length > 0) {
        await bar(row.payer, deps);
        out.failed++;
        logger.warn(
          { paymentId: row.paymentId, payer: row.payer, reason: args.reason },
          'x402: settlement failed; payer barred',
        );
      }
    }
  }
  const missing = rows.filter((r) => !seen.has(r.id));
  if (missing.length > 0) {
    // whole tx reverted (or an item left no event): retry a few times, then give up without barring
    const redis = deps.redis();
    const retry: string[] = [];
    for (const r of missing) {
      const n = await redis.incr(`x402:attempts:${r.id}`);
      if (n >= MAX_REVERTS) {
        await dbRef.db
          .update(x402Payments)
          .set({
            status: 'failed',
            failReason: 'batch_reverted',
            settleTx: rc.transactionHash,
            closedAt: new Date(),
          })
          .where(and(eq(x402Payments.id, r.id), eq(x402Payments.status, 'settling')));
        out.failed++;
      } else retry.push(r.id);
    }
    await requeue(retry, deps);
    out.requeued += retry.length;
  }
  return out;
}

/**
 * One settlement run: sweep expiries, claim up to 25 `closing` payments (urgent first), send
 * `BuyerVault.settle` through the keeper and apply the receipt logs. One bad item only fails itself.
 */
export async function runSettle(deps: SettleDeps = defaultSettleDeps): Promise<SettleSummary> {
  const redis = deps.redis();
  const got = await redis.set(SETTLE_LOCK, '1', 'EX', 600, 'NX');
  if (got !== 'OK') return { skipped: 'locked', expired: 0, settled: 0, failed: 0, requeued: 0 };
  try {
    const sum: SettleSummary = { expired: 0, settled: 0, failed: 0, requeued: 0 };
    sum.expired = await sweep(deps);
    await reconcileSettling(deps);
    await redis.set(CLOSING_COUNTER, 0);

    // postRoot has priority: settlement runs on a critical keeper (it is cheap) but leaves half the critical
    // threshold untouched for the next postRoot.
    const bal = await deps.keeperBalanceWei();
    if (bal < BigInt(config.KEEPER_CRITICAL_ETH_WEI) / 2n) {
      return { ...sum, skipped: 'keeper_balance_reserved_for_post_root' };
    }

    const now = deps.now();
    const claimed = await dbRef.db.transaction(async (tx) => {
      const ready = await tx
        .select()
        .from(x402Payments)
        .where(
          and(
            eq(x402Payments.status, 'closing'),
            sql`${x402Payments.usedMicros} > 0`,
            or(eq(x402Payments.reservedMicros, 0n), lt(x402Payments.closedAt, new Date((now - 1800) * 1000))),
            sql`${x402Payments.deadline} >= ${BigInt(now + EXPIRY_MARGIN_SEC)}`,
          ),
        )
        .orderBy(
          sql`(${x402Payments.deadline} < ${BigInt(now + URGENT_SEC)}) desc`,
          asc(x402Payments.deadline),
        )
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });
      if (ready.length === 0) return [];
      await tx
        .update(x402Payments)
        .set({ status: 'settling', closedAt: new Date(now * 1000) })
        .where(
          inArray(
            x402Payments.id,
            ready.map((r) => r.id),
          ),
        );
      return ready;
    });
    if (claimed.length === 0) return sum;

    let res: KeeperTxResult;
    try {
      res = await deps.send({
        to: deps.vault(),
        data: encodeFunctionData({
          abi: buyerVaultAbi,
          functionName: 'settle',
          args: [claimed.map(toSettlement)],
        }),
        label: 'x402-settle',
      });
    } catch (err) {
      // definitely not broadcast (insufficient funds, estimate revert, ...): try again next run
      logger.error({ err: String(err) }, 'x402: settle not sent; will retry');
      await requeue(
        claimed.map((r) => r.id),
        deps,
      );
      return { ...sum, requeued: claimed.length, skipped: 'send_failed' };
    }
    sum.txHash = res.hash;
    if (res.status === 'unknown') {
      // never re-send; record the hash so reconcile / the indexer can finish it
      await dbRef.db
        .update(x402Payments)
        .set({ settleTx: res.hash })
        .where(
          inArray(
            x402Payments.id,
            claimed.map((r) => r.id),
          ),
        );
      return sum;
    }
    const rc = await deps.receipt(res.hash);
    if (!rc) {
      await dbRef.db
        .update(x402Payments)
        .set({ settleTx: res.hash })
        .where(
          inArray(
            x402Payments.id,
            claimed.map((r) => r.id),
          ),
        );
      return sum;
    }
    const applied = await applyReceipt(claimed, rc, deps);
    return { ...sum, ...applied };
  } finally {
    await redis.del(SETTLE_LOCK);
  }
}
