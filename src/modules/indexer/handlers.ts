import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { credit, ensureBuyer } from '../../db/balances';
import {
  auditLog,
  buyerBalances,
  buyerLedger,
  claims,
  epochs,
  nodes,
  slashCases,
  x402Payments,
} from '../../db/schema';
import type { Tx } from '../../db/types';

export type Stake = { active: bigint; pending: bigint };

/** Decoded log in the shape the handlers need (viem `parseEventLogs` output, narrowed). */
export type IndexedLog = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
};

export type HandlerCtx = {
  /** Block timestamp (cached per block by the caller). */
  blockTime(blockNumber: bigint): Date;
  /**
   * `stakeOf` read at the log's block for the last stake event of each node in the chunk
   * (key = onchain node id as string). Missing entry means "read unavailable": use event deltas.
   */
  stakeReads: Map<string, { key: string; stake: Stake }>;
  /** Node ids (db uuid) whose eligibility changed; published after commit. */
  eligibility: Set<string>;
};

export const JOURNAL_ACTION = 'indexer.event';
export const lower = (s: string) => s.toLowerCase();
const big = (v: unknown) => BigInt(v as bigint | string | number);
export const logKey = (l: Pick<IndexedLog, 'transactionHash' | 'logIndex'>) =>
  `${lower(l.transactionHash)}:${l.logIndex}`;

async function warn(tx: Tx, action: string, log: IndexedLog, details: Record<string, unknown>) {
  await tx.insert(auditLog).values({
    actor: 'indexer',
    action,
    subject: logKey(log),
    details: { block: Number(log.blockNumber), event: log.eventName, ...details },
  });
}

async function journal(tx: Tx, log: IndexedLog, details: Record<string, unknown>) {
  const subject = logKey(log);
  await tx.delete(auditLog).where(and(eq(auditLog.action, JOURNAL_ACTION), eq(auditLog.subject, subject)));
  await tx.insert(auditLog).values({
    actor: 'indexer',
    action: JOURNAL_ACTION,
    subject,
    details: { block: Number(log.blockNumber), event: log.eventName, ...details },
  });
}

async function nodeByOnchainId(tx: Tx, onchainId: bigint) {
  const [row] = await tx.select().from(nodes).where(eq(nodes.onchainId, onchainId));
  return row;
}

export function stakeKey(log: Pick<IndexedLog, 'blockNumber' | 'logIndex'>) {
  return `${log.blockNumber}:${log.logIndex}`;
}

function applyDelta(cur: Stake, log: IndexedLog): Stake {
  const a = log.args;
  switch (log.eventName) {
    case 'Staked':
      return { active: cur.active + big(a.amount), pending: cur.pending };
    case 'UnstakeStarted': {
      const amt = big(a.amount);
      const moved = amt > cur.active ? cur.active : amt;
      return { active: cur.active - moved, pending: cur.pending + moved };
    }
    case 'Unstaked': {
      const amt = big(a.amount);
      return { active: cur.active, pending: amt > cur.pending ? 0n : cur.pending - amt };
    }
    case 'Slashed': {
      const bps = big(a.bps);
      return {
        active: cur.active - (cur.active * bps) / 10_000n,
        pending: cur.pending - (cur.pending * bps) / 10_000n,
      };
    }
    default:
      return cur;
  }
}

/** Apply one decoded log. Every write is idempotent or guarded by a ledger insert. */
export async function applyLog(tx: Tx, log: IndexedLog, ctx: HandlerCtx): Promise<void> {
  const a = log.args;
  const txHash = lower(log.transactionHash);
  switch (log.eventName) {
    case 'Deposited': {
      const buyer = lower(a.buyer as string);
      const amount = big(a.amount);
      const buyerId = await ensureBuyer(tx, buyer);
      const credited = await credit(tx, { buyerId, micros: amount, txHash, logIndex: log.logIndex });
      if (credited) await journal(tx, log, { kind: 'deposit', buyer, amount: amount.toString() });
      return;
    }
    case 'NodeRegistered': {
      const nodeKey = lower(a.nodeKey as string);
      const rows = await tx
        .update(nodes)
        .set({ onchainId: big(a.nodeId), registered: true, owner: lower(a.owner as string) })
        .where(eq(nodes.nodeKey, nodeKey))
        .returning({ id: nodes.id });
      const row = rows[0];
      if (!row) {
        await warn(tx, 'indexer.unknown_node', log, { nodeKey, nodeId: big(a.nodeId).toString() });
        return;
      }
      await journal(tx, log, { nodeId: big(a.nodeId).toString() });
      ctx.eligibility.add(row.id);
      return;
    }
    case 'NodeUpdated': {
      const rows = await tx
        .update(nodes)
        .set({ gpuClass: Number(a.gpuClass), ccCapable: Boolean(a.ccCapable) })
        .where(eq(nodes.onchainId, big(a.nodeId)))
        .returning({ id: nodes.id });
      if (rows.length === 0)
        await warn(tx, 'indexer.unknown_node', log, { nodeId: big(a.nodeId).toString() });
      else {
        await journal(tx, log, { nodeId: big(a.nodeId).toString() });
        ctx.eligibility.add(rows[0]!.id);
      }
      return;
    }
    case 'NodeDeactivated': {
      const rows = await tx
        .update(nodes)
        .set({ status: 'deactivated', registered: false })
        .where(eq(nodes.onchainId, big(a.nodeId)))
        .returning({ id: nodes.id });
      if (rows.length === 0)
        await warn(tx, 'indexer.unknown_node', log, { nodeId: big(a.nodeId).toString() });
      else {
        await journal(tx, log, { nodeId: big(a.nodeId).toString() });
        ctx.eligibility.add(rows[0]!.id);
      }
      return;
    }
    case 'IdentityLinked': {
      // No dedicated column: stored under nodes.benchmark->identity (jsonb).
      const rows = await tx
        .update(nodes)
        .set({
          benchmark: sql`coalesce(${nodes.benchmark}, '{}'::jsonb) || ${JSON.stringify({ identity: big(a.agentId).toString() })}::jsonb`,
        })
        .where(eq(nodes.onchainId, big(a.nodeId)))
        .returning({ id: nodes.id });
      if (rows.length === 0)
        await warn(tx, 'indexer.unknown_node', log, { nodeId: big(a.nodeId).toString() });
      else await journal(tx, log, { nodeId: big(a.nodeId).toString() });
      return;
    }
    case 'Staked':
    case 'UnstakeStarted':
    case 'Unstaked':
    case 'Slashed': {
      const onchainId = big(a.nodeId);
      const node = await nodeByOnchainId(tx, onchainId);
      if (!node) {
        await warn(tx, 'indexer.unknown_node', log, { nodeId: onchainId.toString() });
        return;
      }
      const read = ctx.stakeReads.get(onchainId.toString());
      if (read) {
        // Absolute value read at the node's last stake event in this chunk; earlier events are no-ops.
        if (read.key === stakeKey(log)) {
          await tx
            .update(nodes)
            .set({ stakeSpdl: read.stake.active.toString(), stakePending: read.stake.pending.toString() })
            .where(eq(nodes.id, node.id));
        }
      } else {
        const next = applyDelta({ active: big(node.stakeSpdl), pending: big(node.stakePending) }, log);
        await tx
          .update(nodes)
          .set({ stakeSpdl: next.active.toString(), stakePending: next.pending.toString() })
          .where(eq(nodes.id, node.id));
      }
      if (log.eventName === 'Slashed') {
        await tx
          .update(slashCases)
          .set({ status: 'executed', txHash })
          .where(
            and(
              eq(slashCases.nodeId, node.id),
              eq(slashCases.evidenceHash, lower(a.evidenceHash as string)),
              inArray(slashCases.status, ['open', 'submitted']),
            ),
          );
      }
      await journal(tx, log, { nodeId: onchainId.toString() });
      ctx.eligibility.add(node.id);
      return;
    }
    case 'RootPosted': {
      const epoch = big(a.epoch);
      const rows = await tx
        .update(epochs)
        .set({ status: 'posted', txHash, postedAt: ctx.blockTime(log.blockNumber) })
        .where(eq(epochs.epoch, epoch))
        .returning({ epoch: epochs.epoch });
      if (rows.length === 0) await warn(tx, 'indexer.unknown_epoch', log, { epoch: epoch.toString() });
      else await journal(tx, log, { epoch: epoch.toString() });
      return;
    }
    case 'RootVetoed': {
      const epoch = big(a.epoch);
      const rows = await tx
        .update(epochs)
        .set({ status: 'vetoed' })
        .where(eq(epochs.epoch, epoch))
        .returning({ epoch: epochs.epoch });
      if (rows.length === 0) await warn(tx, 'indexer.unknown_epoch', log, { epoch: epoch.toString() });
      else await journal(tx, log, { epoch: epoch.toString() });
      return;
    }
    case 'Claimed': {
      const values = {
        owner: lower(a.owner as string),
        epoch: big(a.epoch),
        amountUsdgMicros: big(a.amount),
        txHash,
        blockNumber: log.blockNumber,
        status: 'confirmed',
      };
      await tx
        .insert(claims)
        .values(values)
        .onConflictDoUpdate({
          target: claims.txHash,
          set: {
            owner: values.owner,
            epoch: values.epoch,
            amountUsdgMicros: values.amountUsdgMicros,
            blockNumber: values.blockNumber,
            status: 'confirmed',
          },
        });
      await journal(tx, log, { owner: values.owner });
      return;
    }
    case 'Settled':
    case 'SettleFailed': {
      const paymentId = lower(a.paymentId as string);
      const set =
        log.eventName === 'Settled'
          ? {
              status: 'settled',
              settleTx: txHash,
              usedMicros: big(a.used),
              closedAt: ctx.blockTime(log.blockNumber),
            }
          : {
              status: 'failed',
              settleTx: txHash,
              failReason: lower(String(a.reason)),
              closedAt: ctx.blockTime(log.blockNumber),
            };
      const rows = await tx
        .update(x402Payments)
        .set(set)
        .where(eq(x402Payments.paymentId, paymentId))
        .returning({ id: x402Payments.id });
      if (rows.length === 0) await warn(tx, 'indexer.unknown_payment', log, { paymentId });
      else await journal(tx, log, { paymentId });
      return;
    }
    default:
      return;
  }
}

/** Deposits whose ledger rows must be reversed on reorg; used by rollback. */
export async function reverseDeposit(tx: Tx, txHash: string, logIndex: number): Promise<void> {
  const rows = await tx
    .delete(buyerLedger)
    .where(
      and(
        eq(buyerLedger.txHash, txHash),
        eq(buyerLedger.logIndex, logIndex),
        eq(buyerLedger.kind, 'deposit'),
      ),
    )
    .returning({ buyerId: buyerLedger.buyerId, micros: buyerLedger.usdgMicros });
  for (const r of rows) {
    await tx
      .update(buyerBalances)
      .set({
        balanceUsdgMicros: sql`${buyerBalances.balanceUsdgMicros} - ${r.micros}`,
        updatedAt: sql`now()`,
      })
      .where(eq(buyerBalances.buyerId, r.buyerId));
  }
}

export type AddressLike = Address;
