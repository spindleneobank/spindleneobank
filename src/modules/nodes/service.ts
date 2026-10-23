import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { config } from '../../config';
import {
  canaryResults,
  earningEvents,
  jobs,
  models as modelsTable,
  nodes,
  probeResults,
} from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { publicClient } from '../../lib/viem';
import { spindleStakingAbi } from '../../shared/abi';
import { type CatalogModel, DEFAULT_CATALOG } from '../../shared/catalog';
import { classifyGpu, type GpuClass } from '../../shared/gpu';
import type { EnsureModel, HelloBody } from '../../shared/node-protocol';
import { dbRef } from '../auth/constants';

export type NodeRow = typeof nodes.$inferSelect;

/** Runtime settings, overridable in tests (config is frozen). */
export const nodeSettings = {
  registry: (config.REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  chainId: config.CHAIN_ID,
  appUrl: config.PUBLIC_APP_URL.replace(/\/$/, ''),
  apiUrl: config.PUBLIC_API_URL.replace(/\/$/, ''),
  nodeImage: process.env.NODE_IMAGE || 'spindle/node',
  minAgentVersion: process.env.MIN_AGENT_VERSION || '0.1.0',
  jobTimeoutMs: config.JOB_TIMEOUT_MS,
  maxPerIp: 3,
  maxPerOwner: 5,
  livenessTimeoutMs: 45_000,
  sweepMs: 15_000,
  pingMs: 30_000,
  flushMs: 60_000,
  helloTimeoutMs: 10_000,
  bindingValiditySec: 30 * 24 * 3600,
  bindingRefreshBelowSec: 24 * 3600,
};

export const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as const;

// ---- row access --------------------------------------------------------------------------------

export async function loadNodeByKey(nodeKey: string): Promise<NodeRow | null> {
  const [row] = await dbRef.db.select().from(nodes).where(eq(nodes.nodeKey, nodeKey.toLowerCase())).limit(1);
  return row ?? null;
}

export async function loadNodeById(id: string): Promise<NodeRow | null> {
  const [row] = await dbRef.db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
  return row ?? null;
}

export async function loadNodesByIds(ids: string[]): Promise<NodeRow[]> {
  if (ids.length === 0) return [];
  return dbRef.db.select().from(nodes).where(inArray(nodes.id, ids));
}

// ---- hardware classification (server side only) ------------------------------------------------------

export interface Classified {
  gpuClass: GpuClass;
  lane: 'sealed' | 'open';
  ccCapable: boolean;
  gpuModel: string | null;
  gpuCount: number;
  vramMb: number;
  vramGb: number;
}

export function classifyHello(hello: Pick<HelloBody, 'hardware'>): Classified {
  const { gpuClass, lane, ccCapable } = classifyGpu(hello.hardware);
  const gpus = hello.hardware.gpus;
  const vramMb = gpus.reduce((sum, g) => sum + g.vramMb, 0);
  const best = [...gpus].sort((a, b) => b.vramMb - a.vramMb)[0];
  return {
    gpuClass,
    lane,
    ccCapable,
    gpuModel: best?.name ?? null,
    gpuCount: gpus.length,
    vramMb,
    vramGb: Math.round(vramMb / 1024),
  };
}

// ---- catalog ---------------------------------------------------------------------------------

/** Enabled catalog models from the DB (falls back to the shared default catalog when the table is empty). */
export async function loadCatalog(): Promise<CatalogModel[]> {
  const rows = await dbRef.db.select().from(modelsTable).where(eq(modelsTable.enabled, true));
  if (rows.length === 0) return DEFAULT_CATALOG;
  return rows.map((r) => {
    const fallback = DEFAULT_CATALOG.find((m) => m.id === r.id);
    const ids = (r.engineIds ?? {}) as CatalogModel['engineIds'];
    return {
      id: r.id,
      family: r.family ?? fallback?.family ?? r.id,
      kind: (r.kind ?? fallback?.kind ?? 'chat') as CatalogModel['kind'],
      engineIds: ids,
      hfTokenizer: r.hfTokenizer ?? fallback?.hfTokenizer ?? '',
      minVramMb: r.minVramGb != null ? r.minVramGb * 1024 : (fallback?.minVramMb ?? 0),
      sizeMb: fallback?.sizeMb ?? 0,
      lanes: (r.lanes?.length ? r.lanes : (fallback?.lanes ?? ['open'])) as CatalogModel['lanes'],
      unitKind: (r.unitKind ?? fallback?.unitKind ?? 'tokens_1m') as CatalogModel['unitKind'],
    };
  });
}

/** Maps an engine's own model name (hello.models[].id) to a catalog id via `engine_ids`. */
export function catalogIdForEngineModel(
  catalog: CatalogModel[],
  engine: string,
  engineModel: string,
): string | null {
  for (const m of catalog) {
    const id = m.engineIds[engine as 'ollama' | 'vllm'];
    if (id === engineModel) return m.id;
  }
  return null;
}

export function toEnsure(models: { model: CatalogModel }[], engine: string, lane: string): EnsureModel[] {
  const out: EnsureModel[] = [];
  for (const { model } of models) {
    const engineModel = model.engineIds[engine as 'ollama' | 'vllm'];
    if (!engineModel || !model.lanes.includes(lane as 'open' | 'sealed')) continue;
    out.push({ id: model.id, engineModel, sizeMb: model.sizeMb });
  }
  return out;
}

// ---- staking params / min stake cache ----------------------------------------------------------------

export interface StakingParams {
  token: string;
  minStakeByClass: Record<string, string>;
  unstakeDelay: number;
}

const PARAMS_TTL_MS = 10 * 60_000;
let paramsCache: { at: number; value: StakingParams } | null = null;

export function setStakingParamsForTest(value: StakingParams | null): void {
  paramsCache = value ? { at: Date.now(), value } : null;
}

export async function stakingParams(): Promise<StakingParams> {
  if (paramsCache && Date.now() - paramsCache.at < PARAMS_TTL_MS) return paramsCache.value;
  const staking = requireAddress('staking');
  const classes = [1, 2, 3, 4] as const;
  const [token, delay, ...mins] = await Promise.all([
    publicClient.readContract({ address: staking, abi: spindleStakingAbi, functionName: 'spdl' }),
    publicClient.readContract({ address: staking, abi: spindleStakingAbi, functionName: 'UNSTAKE_DELAY' }),
    ...classes.map((c) =>
      publicClient.readContract({
        address: staking,
        abi: spindleStakingAbi,
        functionName: 'minStake',
        args: [c],
      }),
    ),
  ]);
  const minStakeByClass: Record<string, string> = { '0': '0' };
  classes.forEach((c, i) => {
    minStakeByClass[String(c)] = String(mins[i]);
  });
  const value = { token: token as string, minStakeByClass, unstakeDelay: Number(delay) };
  paramsCache = { at: Date.now(), value };
  return value;
}

/** Sync read of the last known per-class minimum (null when never fetched). */
export function cachedMinStake(gpuClass: number): bigint | null {
  const v = paramsCache?.value.minStakeByClass[String(gpuClass)];
  return v == null ? null : BigInt(v);
}

export async function refreshMinStakes(): Promise<void> {
  try {
    await stakingParams();
  } catch (err) {
    logger.debug({ err: String(err) }, 'staking params unavailable');
  }
}

/** Registered on-chain (indexed by B6). Registration is mandatory to receive jobs. */
export const isEligible = (node: Pick<NodeRow, 'registered'>): boolean => node.registered;

/** Active stake >= the class minimum: the priority tier. Unknown minimum counts as not staked. */
export function isStaked(node: Pick<NodeRow, 'stakeSpdl' | 'gpuClass'>): boolean {
  const stake = BigInt(node.stakeSpdl);
  const min = cachedMinStake(node.gpuClass);
  if (min == null || stake <= 0n) return false;
  return stake >= min;
}

// ---- views -------------------------------------------------------------------------------------

export async function toNodeViews(rows: NodeRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const db = dbRef.db;
  const since = new Date(Date.now() - 24 * 3600_000);
  const [earn, probes, canaries] = await Promise.all([
    db
      .select({
        nodeId: earningEvents.nodeId,
        total: sql<string>`coalesce(sum(${earningEvents.usdgMicros}), 0)::text`,
      })
      .from(earningEvents)
      .where(and(inArray(earningEvents.nodeId, ids), gt(earningEvents.ts, since)))
      .groupBy(earningEvents.nodeId),
    db
      .selectDistinctOn([probeResults.nodeId])
      .from(probeResults)
      .where(inArray(probeResults.nodeId, ids))
      .orderBy(probeResults.nodeId, desc(probeResults.createdAt)),
    db
      .selectDistinctOn([canaryResults.nodeId])
      .from(canaryResults)
      .where(inArray(canaryResults.nodeId, ids))
      .orderBy(canaryResults.nodeId, desc(canaryResults.createdAt)),
  ]);
  const earnBy = new Map(earn.map((e) => [e.nodeId, e.total]));
  const probeBy = new Map(probes.map((p) => [p.nodeId, p]));
  const canaryBy = new Map(canaries.map((p) => [p.nodeId, p]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    onchainId: r.onchainId == null ? null : r.onchainId.toString(),
    nodeKey: r.nodeKey,
    status: r.status as 'offline',
    engine: r.engine as 'ollama',
    gpuModel: r.gpuModel,
    gpuCount: r.gpuCount,
    vramGb: r.vramGb,
    gpuClass: r.gpuClass as 0,
    lane: r.lane as 'open',
    ccCapable: r.ccCapable,
    registered: r.registered,
    stake: {
      active: String(r.stakeSpdl),
      pending: String(r.stakePending),
      // The DB has no unlock time; the dashboard reads it on chain when it needs it.
      unlockAt: null,
      min: (cachedMinStake(r.gpuClass) ?? 0n).toString(),
    },
    reputation: r.reputation,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    lastProbe: probeBy.get(r.id) ?? null,
    lastCanary: canaryBy.get(r.id) ?? null,
    earnings24hMicros: earnBy.get(r.id) ?? '0',
    models: Array.isArray(r.models) ? (r.models as unknown[]) : [],
    isHouse: r.isHouse,
  }));
}

export async function ownedNode(userId: string, id: string): Promise<NodeRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'Node not found.');
  const row = await loadNodeById(id);
  // Same response for "missing" and "not yours" so ids cannot be probed.
  if (!row || row.userId !== userId) throw new AppError('NOT_FOUND', 'Node not found.');
  return row;
}

export async function nodeDetail(row: NodeRow) {
  const db = dbRef.db;
  const [view] = await toNodeViews([row]);
  const [probes, canaries, recentJobs] = await Promise.all([
    db
      .select()
      .from(probeResults)
      .where(eq(probeResults.nodeId, row.id))
      .orderBy(desc(probeResults.createdAt))
      .limit(20),
    db
      .select()
      .from(canaryResults)
      .where(eq(canaryResults.nodeId, row.id))
      .orderBy(desc(canaryResults.createdAt))
      .limit(20),
    db
      .select({
        id: jobs.id,
        model: jobs.model,
        kind: jobs.kind,
        lane: jobs.lane,
        status: jobs.status,
        units: jobs.units,
        isCanary: jobs.isCanary,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(eq(jobs.nodeId, row.id))
      .orderBy(desc(jobs.createdAt))
      .limit(20),
  ]);
  return { ...view, probes, canaries, jobs: recentJobs };
}
