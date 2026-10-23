import { spindleStakingAbi } from '@spindle/shared/abi';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { type Address, type Hex, type Log, parseEventLogs } from 'viem';
import { config } from '../../config';
import { db as defaultDb } from '../../db/client';
import { auditLog, claims, epochs, nodes, slashCases, x402Payments } from '../../db/schema';
import type { Db } from '../../db/types';
import { requireAddress } from '../../lib/contracts';
import { logger as defaultLogger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { logsClient } from '../../lib/viem';
import { buyerAbis } from './abis';
import { type BlockRef, pushRecent, RECENT_KEEP, readCursor, writeCursor } from './cursor';
import {
  applyLog,
  type HandlerCtx,
  type IndexedLog,
  JOURNAL_ACTION,
  reverseDeposit,
  type Stake,
  stakeKey,
} from './handlers';

export const CONFIRMATIONS = 12;
export const MIN_CHUNK = 10;
export const LOCK_KEY = 'lock:indexer';
export const LOCK_TTL_MS = 120_000;
export const EVENT_CHANNEL = 'node:evt';

/** The slice of a viem public client the indexer needs (mockable). */
export interface IndexerClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(args: {
    blockNumber: bigint;
  }): Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>;
  getLogs(args: { address: Address[]; fromBlock: bigint; toBlock: bigint }): Promise<Log[]>;
  readStake(nodeId: bigint, blockNumber: bigint): Promise<Stake>;
}

export function viemIndexerClient(): IndexerClient {
  return {
    getBlockNumber: () => logsClient.getBlockNumber(),
    getBlock: ({ blockNumber }) => logsClient.getBlock({ blockNumber }),
    getLogs: ({ address, fromBlock, toBlock }) =>
      logsClient.getLogs({ address, fromBlock, toBlock }) as Promise<Log[]>,
    async readStake(nodeId, blockNumber) {
      const [active, pending] = await logsClient.readContract({
        address: requireAddress('staking'),
        abi: spindleStakingAbi,
        functionName: 'stakeOf',
        args: [nodeId],
        blockNumber,
      });
      return { active, pending };
    },
  };
}

export type IndexerDeps = {
  client: IndexerClient;
  db: Db;
  redis: Pick<Redis, 'set' | 'eval' | 'publish'>;
  logger: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>;
  addresses: Address[];
  deployBlock: number;
  confirmations: number;
  logChunk: number;
};

export function defaultDeps(): IndexerDeps {
  return {
    client: viemIndexerClient(),
    db: defaultDb,
    redis: getRedis(),
    logger: defaultLogger,
    addresses: (['registry', 'staking', 'claims', 'vault'] as const).map((n) => requireAddress(n)),
    deployBlock: config.DEPLOY_BLOCK,
    confirmations: CONFIRMATIONS,
    logChunk: Number(process.env.LOG_CHUNK) > 0 ? Number(process.env.LOG_CHUNK) : 5000,
  };
}

const RANGE_ERR = /range|limit|too many|exceed|10 block|response size|more than|too large|timeout|timed out/i;
export const isRangeError = (e: unknown) =>
  RANGE_ERR.test(
    e instanceof Error ? `${e.message} ${(e as { details?: string }).details ?? ''}` : String(e),
  );

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export type IndexResult = {
  skipped?: 'locked' | 'nothing';
  from?: number;
  to?: number;
  logs?: number;
  rolledBackTo?: number;
};

/** Hash-compare the stored window with the chain; returns the highest block still on the canonical chain. */
async function findAncestor(deps: IndexerDeps, recent: BlockRef[]): Promise<number | null> {
  for (const ref of [...recent].reverse()) {
    const b = await deps.client.getBlock({ blockNumber: BigInt(ref.number) });
    if (b.hash?.toLowerCase() === ref.hash.toLowerCase()) return ref.number;
  }
  return null;
}

/** Undo everything applied above `ancestor`. Runs in the caller's transaction. */
export async function rollbackTo(
  deps: IndexerDeps,
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  ancestor: number,
  eligibility: Set<string>,
): Promise<number> {
  const rows = await tx
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.action, JOURNAL_ACTION), sql`(${auditLog.details}->>'block')::bigint > ${ancestor}`),
    )
    .orderBy(desc(sql`(${auditLog.details}->>'block')::bigint`), desc(auditLog.createdAt));
  const staleNodes = new Set<bigint>();
  for (const r of rows) {
    const d = (r.details ?? {}) as Record<string, string | number>;
    const [txHash, li] = (r.subject ?? ':0').split(':');
    const logIndex = Number(li);
    switch (d.event) {
      case 'Deposited':
        await reverseDeposit(tx, txHash!, logIndex);
        break;
      case 'NodeRegistered': {
        const rs = await tx
          .update(nodes)
          .set({ registered: false, onchainId: null })
          .where(eq(nodes.onchainId, BigInt(d.nodeId!)))
          .returning({ id: nodes.id });
        for (const n of rs) eligibility.add(n.id);
        break;
      }
      case 'NodeDeactivated': {
        const rs = await tx
          .update(nodes)
          .set({ status: 'offline', registered: true })
          .where(eq(nodes.onchainId, BigInt(d.nodeId!)))
          .returning({ id: nodes.id });
        for (const n of rs) eligibility.add(n.id);
        break;
      }
      case 'IdentityLinked':
        await tx
          .update(nodes)
          .set({ benchmark: sql`${nodes.benchmark} - 'identity'` })
          .where(eq(nodes.onchainId, BigInt(d.nodeId!)));
        break;
      case 'Staked':
      case 'UnstakeStarted':
      case 'Unstaked':
      case 'Slashed':
        staleNodes.add(BigInt(d.nodeId!));
        if (d.event === 'Slashed')
          await tx
            .update(slashCases)
            .set({ status: 'submitted', txHash: null })
            .where(eq(slashCases.txHash, txHash!));
        break;
      case 'RootPosted':
        await tx
          .update(epochs)
          .set({ status: 'posting', txHash: null, postedAt: null })
          .where(and(eq(epochs.epoch, BigInt(d.epoch!)), eq(epochs.status, 'posted')));
        break;
      case 'RootVetoed':
        await tx
          .update(epochs)
          .set({ status: 'posted' })
          .where(and(eq(epochs.epoch, BigInt(d.epoch!)), eq(epochs.status, 'vetoed')));
        break;
      case 'Claimed':
        await tx.delete(claims).where(eq(claims.txHash, txHash!));
        break;
      case 'Settled':
      case 'SettleFailed':
        await tx
          .update(x402Payments)
          .set({ status: 'settling', settleTx: null, failReason: null, closedAt: null })
          .where(eq(x402Payments.paymentId, String(d.paymentId)));
        break;
      default:
        break;
    }
  }
  // Stake is recomputed from chain state at the ancestor block (not reversible from deltas alone).
  for (const nodeId of staleNodes) {
    try {
      const s = await deps.client.readStake(nodeId, BigInt(Math.max(ancestor, 0)));
      const rs = await tx
        .update(nodes)
        .set({ stakeSpdl: s.active.toString(), stakePending: s.pending.toString() })
        .where(eq(nodes.onchainId, nodeId))
        .returning({ id: nodes.id });
      for (const n of rs) eligibility.add(n.id);
    } catch (err) {
      deps.logger.error({ err: String(err), nodeId: nodeId.toString() }, 'reorg: could not re-read stake');
    }
  }
  await tx
    .delete(auditLog)
    .where(
      and(eq(auditLog.action, JOURNAL_ACTION), sql`(${auditLog.details}->>'block')::bigint > ${ancestor}`),
    );
  return rows.length;
}

async function publishEligibility(deps: IndexerDeps, ids: Set<string>) {
  for (const nodeId of ids) {
    try {
      await deps.redis.publish(EVENT_CHANNEL, JSON.stringify({ type: 'eligibility', nodeId }));
    } catch (err) {
      deps.logger.warn({ err: String(err) }, 'indexer: eligibility publish failed');
    }
  }
}

/** Fetch logs for [from, to], shrinking the window on range/limit errors. Returns logs and the range actually covered. */
async function fetchChunk(deps: IndexerDeps, from: number, safe: number, size: number) {
  let chunk = size;
  for (;;) {
    const to = Math.min(from + chunk - 1, safe);
    try {
      const logs = await deps.client.getLogs({
        address: deps.addresses,
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
      });
      return { logs, to, chunk };
    } catch (err) {
      if (!isRangeError(err) || chunk <= MIN_CHUNK) throw err;
      chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
      deps.logger.warn({ chunk }, 'indexer: shrinking getLogs range');
    }
  }
}

async function runLocked(deps: IndexerDeps): Promise<IndexResult> {
  const { client, db } = deps;
  const head = Number(await client.getBlockNumber());
  const safe = head - deps.confirmations;
  let cursor = await readCursor(db, deps.deployBlock);
  const result: IndexResult = {};

  // Reorg check.
  if (cursor.recent.length > 0) {
    const ancestor = await findAncestor(deps, cursor.recent);
    const top = cursor.recent[cursor.recent.length - 1]!.number;
    if (ancestor !== top) {
      const base = ancestor ?? Math.min(...cursor.recent.map((r) => r.number)) - 1;
      deps.logger.error(
        { ancestor: base, from: top },
        'CRITICAL: chain reorg deeper than confirmations; rolling back',
      );
      const elig = new Set<string>();
      cursor = await db.transaction(async (tx) => {
        await rollbackTo(deps, tx, base, elig);
        const next = {
          lastSafeBlock: Math.max(base, deps.deployBlock - 1),
          recent: cursor.recent.filter((r) => r.number <= base),
        };
        await writeCursor(tx, next);
        return next;
      });
      await publishEligibility(deps, elig);
      result.rolledBackTo = base;
    }
  }

  let from = cursor.lastSafeBlock + 1;
  if (from > safe) return { ...result, skipped: 'nothing' };
  result.from = from;
  let size = deps.logChunk;
  let total = 0;
  const blockTimes = new Map<bigint, Date>();

  while (from <= safe) {
    const { logs: raw, to, chunk } = await fetchChunk(deps, from, safe, size);
    size = chunk;
    const parsed = parseEventLogs({ abi: buyerAbis, logs: raw, strict: false }) as unknown as (IndexedLog & {
      blockNumber: bigint;
    })[];
    parsed.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);

    // Prefetch everything that needs RPC, so the DB transaction stays short and pure.
    const needTime = new Set(
      parsed
        .filter((l) => ['RootPosted', 'Settled', 'SettleFailed'].includes(l.eventName))
        .map((l) => l.blockNumber),
    );
    for (const bn of needTime) {
      if (!blockTimes.has(bn))
        blockTimes.set(bn, new Date(Number((await client.getBlock({ blockNumber: bn })).timestamp) * 1000));
    }
    const lastStake = new Map<string, IndexedLog>();
    for (const l of parsed) {
      if (['Staked', 'UnstakeStarted', 'Unstaked', 'Slashed'].includes(l.eventName))
        lastStake.set(String(l.args.nodeId), l);
    }
    const stakeReads: HandlerCtx['stakeReads'] = new Map();
    for (const [nodeId, l] of lastStake) {
      try {
        stakeReads.set(nodeId, {
          key: stakeKey(l),
          stake: await client.readStake(BigInt(nodeId), l.blockNumber),
        });
      } catch (err) {
        deps.logger.warn({ err: String(err), nodeId }, 'indexer: stakeOf read failed; using event deltas');
      }
    }
    // Dense hash window over the chunk tail so a later reorg can find its common ancestor.
    let recent = cursor.recent;
    for (let n = Math.max(from, to - RECENT_KEEP + 1); n <= to; n++) {
      const b = await client.getBlock({ blockNumber: BigInt(n) });
      if (b.hash) recent = pushRecent(recent, { number: n, hash: b.hash });
    }
    const ctx: HandlerCtx = {
      blockTime: (bn) => blockTimes.get(bn) ?? new Date(0),
      stakeReads,
      eligibility: new Set(),
    };

    const next = await db.transaction(async (tx) => {
      for (const l of parsed) await applyLog(tx, l, ctx);
      const c = { lastSafeBlock: to, recent };
      await writeCursor(tx, c);
      return c;
    });
    cursor = next;
    await publishEligibility(deps, ctx.eligibility);
    total += parsed.length;
    from = to + 1;
    result.to = to;
  }
  result.logs = total;
  deps.logger.info({ from: result.from, to: result.to, logs: total }, 'indexer: applied');
  return result;
}

/** One indexing pass under the Redis lock. Safe to call concurrently and repeatedly. */
export async function runIndexOnce(deps: IndexerDeps = defaultDeps()): Promise<IndexResult> {
  const token = crypto.randomUUID();
  const got = await deps.redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
  if (got !== 'OK') return { skipped: 'locked' };
  try {
    return await runLocked(deps);
  } finally {
    await deps.redis.eval(RELEASE, 1, LOCK_KEY, token).catch(() => undefined);
  }
}
