import { spindleStakingAbi } from '@spindle/shared/abi';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
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
  applyUndo,
  type HandlerCtx,
  type IndexedLog,
  JOURNAL_ACTION,
  STAKE_EVENTS,
  type Stake,
  stakeKey,
  type Undo,
} from './handlers';
import {
  appendPending,
  deletePending,
  dropPendingAbove,
  loadPending,
  readResync,
  writeResync,
} from './pending';

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
    getBlockNumber: () => logsClient.getBlockNumber({ cacheTime: 0 }),
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
  /** Lock TTL; renewed every third of it. Default 60s. */
  lockTtlMs?: number;
  sleep?: (ms: number) => Promise<void>;
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
    logChunk: config.LOG_CHUNK,
  };
}

// ----------------------------------------------------------- error classes

/** Rate limiting: back off and retry the same range (never shrink). */
const RATE_ERR = /429|rate.?limit|too many requests|compute units|throttl/i;
/** Explicit range / result-size limits: shrink the window. */
const RANGE_ERR =
  /block range|range (is )?too (large|wide|big)|query returned more than|-32005|too many results|log response size|response size (exceeded|limit)|exceed(s|ed)? (the )?max(imum)? (block )?range|up to a \d+ block/i;
const errText = (e: unknown) =>
  e instanceof Error ? `${e.message} ${(e as { details?: string }).details ?? ''}` : String(e);
export const isRateLimitError = (e: unknown) => RATE_ERR.test(errText(e));
export const isRangeError = (e: unknown) => !isRateLimitError(e) && RANGE_ERR.test(errText(e));
const isBlockNotFound = (e: unknown) =>
  (e as { name?: string }).name === 'BlockNotFoundError' ||
  /block .*not found|could not be found/i.test(errText(e));

export class LockLostError extends Error {
  constructor() {
    super('indexer lock lost');
  }
}

const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export type IndexResult = {
  skipped?: 'locked' | 'nothing' | 'lock_lost' | 'no_ancestor' | 'stake_resync';
  from?: number;
  to?: number;
  logs?: number;
  rolledBackTo?: number;
};

type Guard = { check(): void };
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Hash-compare the stored window with the chain, newest first; heights above head are skipped. */
async function findAncestor(deps: IndexerDeps, recent: BlockRef[], head: number): Promise<number | null> {
  for (const ref of [...recent].reverse()) {
    if (ref.number > head) continue;
    try {
      const b = await deps.client.getBlock({ blockNumber: BigInt(ref.number) });
      if (b.hash?.toLowerCase() === ref.hash.toLowerCase()) return ref.number;
    } catch (err) {
      if (!isBlockNotFound(err)) throw err;
    }
  }
  return null;
}

/** Undo everything applied above `ancestor`. Runs in the caller's transaction. */
export async function rollbackTo(
  deps: IndexerDeps,
  tx: DbTx,
  ancestor: number,
  eligibility: Set<string>,
): Promise<void> {
  const blockOf = sql`(${auditLog.details}->>'block')::bigint`;
  const rows = await tx
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, JOURNAL_ACTION), sql`${blockOf} > ${ancestor}`))
    .orderBy(desc(blockOf), desc(sql`(${auditLog.details}->>'logIndex')::int`));
  const staleNodes = new Set<string>();
  for (const r of rows) {
    const d = (r.details ?? {}) as { event?: string; nodeId?: string; undo?: Undo[] };
    for (const u of [...(d.undo ?? [])].reverse()) {
      const nodeUuid = await applyUndo(tx, u);
      if (nodeUuid) eligibility.add(nodeUuid);
    }
    if (d.event && STAKE_EVENTS.includes(d.event) && d.nodeId) staleNodes.add(d.nodeId);
  }

  // Stake cannot be undone from prior values; re-read it at the ancestor block. On failure keep the
  // journal rows and flag the node so later runs retry (never silently keep a wrong stake).
  const failed = new Set<string>();
  for (const nodeId of staleNodes) {
    try {
      const s = await deps.client.readStake(BigInt(nodeId), BigInt(Math.max(ancestor, 0)));
      const rs = await tx
        .update(nodes)
        .set({ stakeSpdl: s.active.toString(), stakePending: s.pending.toString() })
        .where(eq(nodes.onchainId, BigInt(nodeId)))
        .returning({ id: nodes.id });
      for (const n of rs) eligibility.add(n.id);
    } catch (err) {
      failed.add(nodeId);
      deps.logger.error({ err: String(err), nodeId }, 'reorg: could not re-read stake; flagged for resync');
    }
  }
  if (failed.size > 0) await writeResync(tx, [...(await readResync(tx)), ...failed]);

  const isKept = (r: (typeof rows)[number]) => {
    const d = (r.details ?? {}) as { event?: string; nodeId?: string };
    return !!(d.event && STAKE_EVENTS.includes(d.event) && d.nodeId && failed.has(d.nodeId));
  };
  const deletable = rows.filter((r) => !isKept(r)).map((r) => r.id);
  const orphaned = rows.filter(isKept).map((r) => r.id);
  if (orphaned.length > 0)
    await tx
      .update(auditLog)
      .set({ details: sql`${auditLog.details} || '{"orphaned":true}'::jsonb` })
      .where(inArray(auditLog.id, orphaned));
  if (deletable.length > 0) await tx.delete(auditLog).where(inArray(auditLog.id, deletable));
  // The indexer's own warning rows above the ancestor describe events that no longer exist.
  await tx
    .delete(auditLog)
    .where(
      and(eq(auditLog.actor, 'indexer'), ne(auditLog.action, JOURNAL_ACTION), sql`${blockOf} > ${ancestor}`),
    );
  await dropPendingAbove(tx, ancestor);
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

/** Fetch logs for [from, to], shrinking on range errors and backing off on rate limits. */
async function fetchChunk(deps: IndexerDeps, guard: Guard, from: number, safe: number, size: number) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let chunk = size;
  let backoffs = 0;
  for (;;) {
    guard.check();
    const to = Math.min(from + chunk - 1, safe);
    try {
      const logs = await deps.client.getLogs({
        address: deps.addresses,
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
      });
      return { logs, to, chunk };
    } catch (err) {
      if (isRateLimitError(err)) {
        if (backoffs >= MAX_BACKOFFS) throw err;
        const wait = Math.min(1000 * 2 ** backoffs++, 15_000);
        deps.logger.warn({ wait }, 'indexer: rate limited; retrying same range');
        await sleep(wait);
        continue;
      }
      if (!isRangeError(err) || chunk <= MIN_CHUNK) throw err;
      chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
      deps.logger.warn({ chunk }, 'indexer: shrinking getLogs range');
    }
  }
}
const MAX_BACKOFFS = 5;

function parseLogs(raw: Log[]): IndexedLog[] {
  const parsed = parseEventLogs({ abi: buyerAbis, logs: raw, strict: false }) as unknown as IndexedLog[];
  return parsed.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
}

/** Read stakeOf for the last stake event per node. `atBlock` overrides the event's own block. */
async function prefetchStake(deps: IndexerDeps, logs: IndexedLog[], atBlock?: bigint) {
  const last = new Map<string, IndexedLog>();
  for (const l of logs) if (STAKE_EVENTS.includes(l.eventName)) last.set(String(l.args.nodeId), l);
  const reads: HandlerCtx['stakeReads'] = new Map();
  for (const [nodeId, l] of last) {
    try {
      reads.set(nodeId, {
        key: stakeKey(l),
        stake: await deps.client.readStake(BigInt(nodeId), atBlock ?? l.blockNumber),
      });
    } catch (err) {
      deps.logger.warn({ err: String(err), nodeId }, 'indexer: stakeOf read failed; using event deltas');
    }
  }
  return reads;
}

/** Retry parked events (node row may have been created since). */
async function retryPending(deps: IndexerDeps, guard: Guard, lastSafe: number) {
  const parked = await loadPending(deps.db);
  for (const p of parked) {
    guard.check();
    const stakeReads = await prefetchStake(deps, p.events, BigInt(Math.max(lastSafe, 0)));
    const ctx: HandlerCtx = { blockTime: () => new Date(0), stakeReads, eligibility: new Set(), retry: true };
    const resolved = await deps.db.transaction(async (tx) => {
      const results = [];
      for (const e of p.events) results.push(await applyLog(tx, e, ctx));
      const ok = results.every((r) => !r.pending);
      if (ok) await deletePending(tx, p.key);
      guard.check();
      return ok;
    });
    if (resolved) await publishEligibility(deps, ctx.eligibility);
  }
}

/** Retry flagged stake resyncs at the cursor block. Returns false when any is still failing. */
async function resyncStakes(deps: IndexerDeps, lastSafe: number): Promise<boolean> {
  const flagged = await readResync(deps.db);
  if (flagged.length === 0) return true;
  const still: string[] = [];
  const elig = new Set<string>();
  const done: string[] = [];
  const reads = new Map<string, Stake>();
  for (const nodeId of flagged) {
    try {
      reads.set(nodeId, await deps.client.readStake(BigInt(nodeId), BigInt(Math.max(lastSafe, 0))));
      done.push(nodeId);
    } catch {
      still.push(nodeId);
    }
  }
  await deps.db.transaction(async (tx) => {
    for (const [nodeId, s] of reads) {
      const rs = await tx
        .update(nodes)
        .set({ stakeSpdl: s.active.toString(), stakePending: s.pending.toString() })
        .where(eq(nodes.onchainId, BigInt(nodeId)))
        .returning({ id: nodes.id });
      for (const n of rs) elig.add(n.id);
      // Journal rows kept by a failed rollback read describe events that are no longer applied.
      const rows = await tx
        .select({ id: auditLog.id, d: auditLog.details })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, JOURNAL_ACTION),
            sql`(${auditLog.details}->>'nodeId') = ${nodeId}`,
            sql`(${auditLog.details}->>'orphaned') = 'true'`,
          ),
        );
      if (rows.length > 0)
        await tx.delete(auditLog).where(
          inArray(
            auditLog.id,
            rows.map((r) => r.id),
          ),
        );
    }
    await writeResync(tx, still);
  });
  await publishEligibility(deps, elig);
  if (still.length > 0)
    deps.logger.error({ nodes: still }, 'indexer: stake resync still failing; run skipped');
  return still.length === 0;
}

async function runLocked(deps: IndexerDeps, guard: Guard): Promise<IndexResult> {
  const { client, db } = deps;
  const head = Number(await client.getBlockNumber());
  const safe = head - deps.confirmations;
  let cursor = await readCursor(db, deps.deployBlock);
  const result: IndexResult = {};

  if (!(await resyncStakes(deps, cursor.lastSafeBlock))) return { skipped: 'stake_resync' };

  // Reorg check.
  if (cursor.recent.length > 0) {
    const ancestor = await findAncestor(deps, cursor.recent, head);
    const top = cursor.recent[cursor.recent.length - 1]?.number;
    if (ancestor === null) {
      deps.logger.error(
        { oldest: cursor.recent[0]?.number, top },
        'CRITICAL: no common ancestor within the stored window (reorg deeper than 64 blocks); indexing halted',
      );
      return { skipped: 'no_ancestor' };
    }
    if (ancestor !== top) {
      deps.logger.error(
        { ancestor, from: top },
        'CRITICAL: chain reorg deeper than confirmations; rolling back',
      );
      const elig = new Set<string>();
      const base = cursor;
      cursor = await db.transaction(async (tx) => {
        await rollbackTo(deps, tx, ancestor, elig);
        const next = {
          lastSafeBlock: Math.max(ancestor, deps.deployBlock - 1),
          recent: base.recent.filter((r) => r.number <= ancestor),
        };
        await writeCursor(tx, next);
        guard.check();
        return next;
      });
      await publishEligibility(deps, elig);
      result.rolledBackTo = ancestor;
    }
  }

  await retryPending(deps, guard, cursor.lastSafeBlock);

  let from = cursor.lastSafeBlock + 1;
  if (from > safe) return { ...result, skipped: 'nothing' };
  result.from = from;
  let size = deps.logChunk;
  let total = 0;
  const blockTimes = new Map<bigint, Date>();

  while (from <= safe) {
    const { logs: raw, to, chunk } = await fetchChunk(deps, guard, from, safe, size);
    size = chunk;
    const parsed = parseLogs(raw);

    // Prefetch everything that needs RPC, so the DB transaction stays short and pure.
    for (const l of parsed) {
      if (!['RootPosted', 'Settled', 'SettleFailed'].includes(l.eventName) || blockTimes.has(l.blockNumber))
        continue;
      const b = await client.getBlock({ blockNumber: l.blockNumber });
      blockTimes.set(l.blockNumber, new Date(Number(b.timestamp) * 1000));
    }
    const stakeReads = await prefetchStake(deps, parsed);
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

    guard.check();
    cursor = await db.transaction(async (tx) => {
      for (const l of parsed) {
        const r = await applyLog(tx, l, ctx);
        if (r.pending) await appendPending(tx, r.pending, l);
      }
      const c = { lastSafeBlock: to, recent };
      await writeCursor(tx, c);
      guard.check(); // lock still ours -> commit; otherwise throw and roll back
      return c;
    });
    await publishEligibility(deps, ctx.eligibility);
    total += parsed.length;
    from = to + 1;
    result.to = to;
  }
  result.logs = total;
  deps.logger.info({ from: result.from, to: result.to, logs: total }, 'indexer: applied');
  return result;
}

/** One indexing pass under the Redis lock (renewed while running). Safe to call concurrently. */
export async function runIndexOnce(deps: IndexerDeps = defaultDeps()): Promise<IndexResult> {
  const token = crypto.randomUUID();
  const ttl = deps.lockTtlMs ?? LOCK_TTL_MS;
  const got = await deps.redis.set(LOCK_KEY, token, 'PX', ttl, 'NX');
  if (got !== 'OK') return { skipped: 'locked' };
  let lost = false;
  const timer = setInterval(
    () => {
      Promise.resolve(deps.redis.eval(RENEW, 1, LOCK_KEY, token, String(ttl)))
        .then((r) => {
          if (Number(r) !== 1) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    },
    Math.max(10, Math.floor(ttl / 3)),
  );
  const guard: Guard = {
    check() {
      if (lost) throw new LockLostError();
    },
  };
  try {
    return await runLocked(deps, guard);
  } catch (err) {
    if (err instanceof LockLostError) {
      deps.logger.warn({}, 'indexer: lock lost mid-run; aborted cleanly');
      return { skipped: 'lock_lost' };
    }
    throw err;
  } finally {
    clearInterval(timer);
    await deps.redis.eval(RELEASE, 1, LOCK_KEY, token).catch(() => undefined);
  }
}
