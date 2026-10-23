import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Hex } from 'viem';
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
import { dec, enc } from './codec';

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
   * `stakeOf` for the last stake event of each node in the batch (key = onchain node id as string).
   * Missing entry means "read unavailable": use event deltas.
   */
  stakeReads: Map<string, { key: string; stake: Stake }>;
  /** Node ids (db uuid) whose eligibility changed; published after commit. */
  eligibility: Set<string>;
  /** Re-trying a parked event: do not write warnings again. */
  retry?: boolean;
};

/** Result of applying one log. `pending` = parked in kv until the node row exists. */
export type ApplyResult = { pending?: string };

export const JOURNAL_ACTION = 'indexer.event';
export const STAKE_EVENTS = ['Staked', 'UnstakeStarted', 'Unstaked', 'Slashed'];
export const lower = (s: string) => s.toLowerCase();
const big = (v: unknown) => BigInt(v as bigint | string | number);
export const logKey = (l: Pick<IndexedLog, 'transactionHash' | 'logIndex'>) =>
  `${lower(l.transactionHash)}:${l.logIndex}`;
export const stakeKey = (log: Pick<IndexedLog, 'blockNumber' | 'logIndex'>) =>
  `${log.blockNumber}:${log.logIndex}`;

// ------------------------------------------------------------ undo journal

type UndoTable = 'nodes' | 'x402' | 'epochs' | 'claims' | 'slash';
/** Prior values of every field an event mutated; `before: null` means the row was inserted by the event. */
export type Undo =
  | { t: UndoTable; key: unknown; before: Record<string, unknown> | null }
  | { t: 'deposit'; key: { txHash: string; logIndex: number }; before: null };

const TABLES = {
  nodes: { tbl: nodes, prop: 'id' },
  x402: { tbl: x402Payments, prop: 'id' },
  epochs: { tbl: epochs, prop: 'epoch' },
  claims: { tbl: claims, prop: 'txHash' },
  slash: { tbl: slashCases, prop: 'id' },
} as const;

// biome-ignore lint/suspicious/noExplicitAny: generic over drizzle tables
const col = (t: UndoTable, prop?: string): any => (TABLES[t].tbl as any)[prop ?? TABLES[t].prop];

/** Update `row` with `set`, recording the prior values for rollback. */
async function mutate(
  tx: Tx,
  undo: Undo[],
  t: UndoTable,
  row: Record<string, unknown>,
  set: Record<string, unknown>,
): Promise<void> {
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(set)) before[k] = row[k] ?? null;
  const keyVal = row[TABLES[t].prop];
  // biome-ignore lint/suspicious/noExplicitAny: generic over drizzle tables
  await tx
    .update(TABLES[t].tbl as any)
    .set(set as never)
    .where(eq(col(t), keyVal as never));
  undo.push({ t, key: enc(keyVal), before: enc(before) as Record<string, unknown> });
}

/** Restore one undo entry. Returns the node id when a nodes row was touched. */
export async function applyUndo(tx: Tx, u: Undo): Promise<string | null> {
  if (u.t === 'deposit') {
    await reverseDeposit(tx, u.key.txHash, u.key.logIndex);
    return null;
  }
  const key = dec(u.key);
  if (u.before === null) {
    // biome-ignore lint/suspicious/noExplicitAny: generic over drizzle tables
    await tx.delete(TABLES[u.t].tbl as any).where(eq(col(u.t), key as never));
    return null;
  }
  // biome-ignore lint/suspicious/noExplicitAny: generic over drizzle tables
  await tx
    .update(TABLES[u.t].tbl as any)
    .set(dec(u.before) as never)
    .where(eq(col(u.t), key as never));
  return u.t === 'nodes' ? String(key) : null;
}

async function warn(
  tx: Tx,
  ctx: HandlerCtx,
  action: string,
  log: IndexedLog,
  details: Record<string, unknown>,
) {
  if (ctx.retry) return;
  await tx.insert(auditLog).values({
    actor: 'indexer',
    action,
    subject: logKey(log),
    details: { block: Number(log.blockNumber), logIndex: log.logIndex, event: log.eventName, ...details },
  });
}

async function journal(tx: Tx, log: IndexedLog, undo: Undo[], details: Record<string, unknown> = {}) {
  const subject = logKey(log);
  await tx.delete(auditLog).where(and(eq(auditLog.action, JOURNAL_ACTION), eq(auditLog.subject, subject)));
  await tx.insert(auditLog).values({
    actor: 'indexer',
    action: JOURNAL_ACTION,
    subject,
    details: {
      block: Number(log.blockNumber),
      logIndex: log.logIndex,
      event: log.eventName,
      undo,
      ...details,
    },
  });
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
export async function applyLog(tx: Tx, log: IndexedLog, ctx: HandlerCtx): Promise<ApplyResult> {
  const a = log.args;
  const txHash = lower(log.transactionHash);
  const undo: Undo[] = [];
  const unknownNode = async (id: bigint): Promise<ApplyResult> => {
    await warn(tx, ctx, 'indexer.unknown_node', log, { nodeId: id.toString() });
    return { pending: id.toString() };
  };
  const nodeById = async (id: bigint) => (await tx.select().from(nodes).where(eq(nodes.onchainId, id)))[0];

  switch (log.eventName) {
    case 'Deposited': {
      const buyer = lower(a.buyer as string);
      const amount = big(a.amount);
      const buyerId = await ensureBuyer(tx, buyer);
      const credited = await credit(tx, { buyerId, micros: amount, txHash, logIndex: log.logIndex });
      if (credited) {
        undo.push({ t: 'deposit', key: { txHash, logIndex: log.logIndex }, before: null });
        await journal(tx, log, undo, { buyer, amount: amount.toString() });
      }
      return {};
    }
    case 'NodeRegistered': {
      const nodeKey = lower(a.nodeKey as string);
      const [row] = await tx.select().from(nodes).where(eq(nodes.nodeKey, nodeKey));
      if (!row) {
        await warn(tx, ctx, 'indexer.unknown_node', log, { nodeKey, nodeId: big(a.nodeId).toString() });
        return { pending: nodeKey };
      }
      await mutate(tx, undo, 'nodes', row, {
        onchainId: big(a.nodeId),
        registered: true,
        owner: lower(a.owner as string),
      });
      await journal(tx, log, undo, { nodeId: big(a.nodeId).toString() });
      ctx.eligibility.add(row.id);
      return {};
    }
    case 'NodeUpdated': {
      const row = await nodeById(big(a.nodeId));
      if (!row) return unknownNode(big(a.nodeId));
      await mutate(tx, undo, 'nodes', row, { gpuClass: Number(a.gpuClass), ccCapable: Boolean(a.ccCapable) });
      await journal(tx, log, undo);
      ctx.eligibility.add(row.id);
      return {};
    }
    case 'NodeDeactivated': {
      const row = await nodeById(big(a.nodeId));
      if (!row) return unknownNode(big(a.nodeId));
      await mutate(tx, undo, 'nodes', row, { status: 'deactivated', registered: false });
      await journal(tx, log, undo);
      ctx.eligibility.add(row.id);
      return {};
    }
    case 'IdentityLinked': {
      // No dedicated column: stored under nodes.benchmark->identity (jsonb).
      const row = await nodeById(big(a.nodeId));
      if (!row) return unknownNode(big(a.nodeId));
      const bench = {
        ...((row.benchmark as Record<string, unknown> | null) ?? {}),
        identity: big(a.agentId).toString(),
      };
      await mutate(tx, undo, 'nodes', row, { benchmark: bench });
      await journal(tx, log, undo);
      return {};
    }
    case 'Staked':
    case 'UnstakeStarted':
    case 'Unstaked':
    case 'Slashed': {
      const onchainId = big(a.nodeId);
      const node = await nodeById(onchainId);
      if (!node) return unknownNode(onchainId);
      // Stake is not undone from prior values: rollback re-reads stakeOf at the ancestor block.
      const read = ctx.stakeReads.get(onchainId.toString());
      let next: Stake | null = null;
      if (read) {
        if (read.key === stakeKey(log)) next = read.stake;
      } else {
        next = applyDelta({ active: big(node.stakeSpdl), pending: big(node.stakePending) }, log);
      }
      if (next)
        await tx
          .update(nodes)
          .set({ stakeSpdl: next.active.toString(), stakePending: next.pending.toString() })
          .where(eq(nodes.id, node.id));
      if (log.eventName === 'Slashed') {
        const cases = await tx
          .select()
          .from(slashCases)
          .where(
            and(
              eq(slashCases.nodeId, node.id),
              eq(slashCases.evidenceHash, lower(a.evidenceHash as string)),
              inArray(slashCases.status, ['open', 'submitted']),
            ),
          );
        for (const c of cases) await mutate(tx, undo, 'slash', c, { status: 'executed', txHash });
      }
      await journal(tx, log, undo, { nodeId: onchainId.toString() });
      ctx.eligibility.add(node.id);
      return {};
    }
    case 'RootPosted': {
      const epoch = big(a.epoch);
      const [row] = await tx.select().from(epochs).where(eq(epochs.epoch, epoch));
      if (!row) {
        await warn(tx, ctx, 'indexer.unknown_epoch', log, { epoch: epoch.toString() });
        return {};
      }
      await mutate(tx, undo, 'epochs', row, {
        status: 'posted',
        txHash,
        postedAt: ctx.blockTime(log.blockNumber),
      });
      await journal(tx, log, undo);
      return {};
    }
    case 'RootVetoed': {
      const epoch = big(a.epoch);
      const [row] = await tx.select().from(epochs).where(eq(epochs.epoch, epoch));
      if (!row) {
        await warn(tx, ctx, 'indexer.unknown_epoch', log, { epoch: epoch.toString() });
        return {};
      }
      await mutate(tx, undo, 'epochs', row, { status: 'vetoed' });
      await journal(tx, log, undo);
      return {};
    }
    case 'Claimed': {
      const set = {
        owner: lower(a.owner as string),
        epoch: big(a.epoch),
        amountUsdgMicros: big(a.amount),
        blockNumber: log.blockNumber,
        status: 'confirmed',
      };
      const [existing] = await tx.select().from(claims).where(eq(claims.txHash, txHash));
      if (existing) await mutate(tx, undo, 'claims', existing, set);
      else {
        await tx.insert(claims).values({ ...set, txHash });
        undo.push({ t: 'claims', key: txHash, before: null });
      }
      await journal(tx, log, undo);
      return {};
    }
    case 'Settled':
    case 'SettleFailed': {
      const paymentId = lower(a.paymentId as string);
      const [row] = await tx.select().from(x402Payments).where(eq(x402Payments.paymentId, paymentId));
      if (!row) {
        await warn(tx, ctx, 'indexer.unknown_payment', log, { paymentId });
        return {};
      }
      const closedAt = ctx.blockTime(log.blockNumber);
      const set =
        log.eventName === 'Settled'
          ? { status: 'settled', settleTx: txHash, usedMicros: big(a.used), closedAt }
          : { status: 'failed', settleTx: txHash, failReason: lower(String(a.reason)), closedAt };
      await mutate(tx, undo, 'x402', row, set);
      await journal(tx, log, undo);
      return {};
    }
    default:
      return {};
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
