import { erc20Abi } from '@spindle/shared/abi';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Address } from 'viem';
import { config } from '../../config';
import { auditLog, epochs, kv, models as modelsTable, nodes } from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getQueue, QUEUE_NAMES } from '../../lib/queue';
import { getRedis } from '../../lib/redis';
import { publicClient } from '../../lib/viem';
import { DEFAULT_CATALOG } from '../../shared/catalog';
import { dbRef } from '../auth/constants';
import { type KeeperState, keeperState } from '../chain/service';
import { ALERT_KEY as EPOCH_ALERT_KEY } from '../epochs/poster';
import { defaultFloorChain, ALERT_KEY as FLOOR_ALERT_KEY, floorStatus, solvency } from '../floor/service';
import { utcDay } from '../gateway/pricing';
import { nodeHub } from '../nodes/hub';
import type { RateRow } from '../rates/defaults';
import { addDays, ensureRateCard, rateCardFor, setRateCard } from '../rates/service';
import { x402State } from '../x402/guard';
import { BARRED_KEY } from '../x402/verify';
import { cardReviewCount, computeKillMetrics, evaluateKill } from './metrics';

// ---- chain / infra reads (injectable) -------------------------------------------------------------

export interface AdminDeps {
  usdgBalance(owner: Address): Promise<bigint>;
  totalClaimed(): Promise<bigint>;
  keeper(): Promise<KeeperState>;
  queueCounts(): Promise<
    Record<string, { waiting: number; active: number; failed: number; delayed: number }>
  >;
  barredPayers(): Promise<string[]>;
  refreshCatalog(): Promise<void>;
  addresses(): { claims?: Address; treasury?: Address };
  now(): Date;
  /** HOUSE_OWNER_ADDRESS (injectable for tests). */
  houseOwner?(): string | undefined;
}

export const defaultAdminDeps: AdminDeps = {
  usdgBalance: (owner) =>
    publicClient.readContract({
      address: requireAddress('usdg'),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    }) as Promise<bigint>,
  totalClaimed: () => defaultFloorChain.totalClaimed(),
  keeper: () => keeperState(),
  async queueCounts() {
    const out: Record<string, { waiting: number; active: number; failed: number; delayed: number }> = {};
    for (const name of QUEUE_NAMES) {
      const c = await getQueue(name).getJobCounts('waiting', 'active', 'failed', 'delayed');
      out[name] = {
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        failed: c.failed ?? 0,
        delayed: c.delayed ?? 0,
      };
    }
    return out;
  },
  barredPayers: () => getRedis().smembers(BARRED_KEY),
  refreshCatalog: () => nodeHub.refreshCatalog(),
  addresses: () => ({
    claims: config.CLAIMS_ADDRESS as Address | undefined,
    treasury: config.TREASURY_ADDRESS as Address | undefined,
  }),
  now: () => new Date(),
};

async function safe<T>(label: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const str = (v: bigint | null): string | null => (v === null ? null : v.toString());

const kvValue = async (key: string) =>
  (await dbRef.db.select().from(kv).where(eq(kv.key, key)))[0]?.value ?? null;

// ---- overview -------------------------------------------------------------------------------------

export async function overview(deps: AdminDeps = defaultAdminDeps) {
  const now = deps.now();
  const errors: string[] = [];
  const { claims, treasury } = deps.addresses();

  const [treasuryUsdg, keeper, pool, claimed, sol, queues, barred, review, metrics, lastEpoch, x402, floor] =
    await Promise.all([
      safe('treasury usdg', errors, async () =>
        treasury ? deps.usdgBalance(treasury) : Promise.reject(new Error('TREASURY_ADDRESS not set')),
      ),
      safe('keeper', errors, () => deps.keeper()),
      safe('claims pool', errors, async () =>
        claims ? deps.usdgBalance(claims) : Promise.reject(new Error('CLAIMS_ADDRESS not set')),
      ),
      safe('claims totalClaimed', errors, () => deps.totalClaimed()),
      safe('solvency', errors, () =>
        solvency({
          poolBalance: () =>
            claims ? deps.usdgBalance(claims) : Promise.reject(new Error('CLAIMS_ADDRESS not set')),
          totalClaimed: () => deps.totalClaimed(),
        }),
      ),
      safe('queues', errors, () => deps.queueCounts()),
      safe('x402 barred', errors, () => deps.barredPayers()),
      safe('card review count', errors, () => cardReviewCount()),
      safe('kill metrics', errors, () => computeKillMetrics(now)),
      safe('last epoch', errors, async () => {
        const [e] = await dbRef.db.select().from(epochs).orderBy(desc(epochs.epoch)).limit(1);
        return e ?? null;
      }),
      safe('x402 state', errors, () => x402State()),
      safe('floor', errors, () => floorStatus(now, 6)),
    ]);
  const keeperUsdg = keeper
    ? await safe('keeper usdg', errors, () => deps.usdgBalance(keeper.address))
    : null;

  const [postedEpoch] = await dbRef.db
    .select({ t: epochs.totalEarnedUsdgMicros, e: epochs.epoch })
    .from(epochs)
    .where(eq(epochs.status, 'posted'))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  const postedOwed =
    postedEpoch && claimed !== null ? (postedEpoch.t > claimed ? postedEpoch.t - claimed : 0n) : null;
  const topUp = sol ? (sol.headroomMicros < 0n ? -sol.headroomMicros : 0n) : null;

  return {
    generatedAt: now.toISOString(),
    balances: {
      treasuryUsdgMicros: str(treasuryUsdg),
      keeperEthWei: keeper?.balanceWei ?? null,
      keeperUsdgMicros: str(keeperUsdg),
      claimsPoolUsdgMicros: str(pool),
      /** totalEarned (latest posted root) − totalClaimed, as the contract sees it. */
      claimsOwedMicros: str(postedOwed),
    },
    solvency: sol
      ? {
          claimedMicros: sol.claimedMicros.toString(),
          earnedIncludingUnpostedMicros: sol.earnedMicros.toString(),
          /** Owed once every recorded earning (including floor and not-yet-posted events) is posted. */
          owedIncludingPendingMicros: sol.owedMicros.toString(),
          headroomMicros: sol.headroomMicros.toString(),
          /** USDG micros the owner must transfer from the treasury to SpindleClaims to keep the pool solvent. */
          topUpNeededMicros: (topUp ?? 0n).toString(),
          treasuryCanCover: treasuryUsdg !== null && topUp !== null ? treasuryUsdg >= topUp : null,
          claimsAddress: claims ?? null,
          ok: topUp === 0n,
        }
      : null,
    keeper: keeper
      ? {
          address: keeper.address,
          level: keeper.level,
          balanceWei: keeper.balanceWei,
          checkedAt: keeper.checkedAt,
        }
      : null,
    killMetrics: metrics && {
      liveNodes: metrics.liveNodes,
      sealedNodes: metrics.sealedNodes,
      buyerSpend30dMicros: metrics.buyerSpend30dMicros.toString(),
      cardStockShareBps: metrics.cardStockShareBps,
      cardStockNote: metrics.cardStockNote,
      floorShareBps: metrics.floorShareBps,
      providerPayouts30dMicros: metrics.providerPayouts30dMicros.toString(),
      floorPayouts30dMicros: metrics.floorPayouts30dMicros.toString(),
    },
    killCriteria: metrics ? evaluateKill(metrics, now) : null,
    queues,
    lastEpoch: lastEpoch ? Number(lastEpoch.epoch) : null,
    lastEpochDetail: lastEpoch && {
      epoch: Number(lastEpoch.epoch),
      status: lastEpoch.status,
      root: lastEpoch.root,
      totalEarnedMicros: lastEpoch.totalEarnedUsdgMicros.toString(),
      owners: lastEpoch.owners,
      builtAt: lastEpoch.builtAt.toISOString(),
      postedAt: lastEpoch.postedAt?.toISOString() ?? null,
      txHash: lastEpoch.txHash,
    },
    alerts: {
      epoch: await kvValue(EPOCH_ALERT_KEY),
      floor: await kvValue(FLOOR_ALERT_KEY),
    },
    x402: x402 && { ...x402, barredPayers: barred ?? [] },
    cards: { reviewOperations: review },
    floor: floor && {
      enabled: floor.enabled,
      day: floor.day,
      decayBps: floor.decayBps,
      budgetMicros: floor.budgetMicros.toString(),
    },
    errors,
  };
}

// ---- audit ----------------------------------------------------------------------------------------

export async function audit(actor: string, action: string, subject: string, details: unknown) {
  await dbRef.db.insert(auditLog).values({ actor, action, subject, details });
}

// ---- rate card (tomorrow) -------------------------------------------------------------------------

type RateRowJson = {
  gpuClass: number;
  lane: string;
  unitKind: string;
  providerMicrosPerUnit: string;
  buyerMicrosPerUnit: string;
};
const rowToJson = (r: RateRow): RateRowJson => ({
  gpuClass: r.gpuClass,
  lane: r.lane,
  unitKind: r.unitKind,
  providerMicrosPerUnit: r.providerMicrosPerUnit.toString(),
  buyerMicrosPerUnit: r.buyerMicrosPerUnit.toString(),
});

export async function getRateCard(now = new Date()) {
  const today = utcDay(now);
  const day = addDays(today, 1);
  await ensureRateCard(day);
  return {
    day,
    rows: (await rateCardFor(day)).map(rowToJson),
    today: { day: today, frozen: true, rows: (await rateCardFor(today)).map(rowToJson) },
  };
}

export async function putRateCard(rows: Omit<RateRowJson, never>[], actor: string, now = new Date()) {
  const day = addDays(utcDay(now), 1);
  const keys = new Set<string>();
  for (const r of rows) {
    const k = `${r.gpuClass}:${r.lane}:${r.unitKind}`;
    if (keys.has(k)) throw new AppError('VALIDATION', `Duplicate rate row ${k}.`);
    keys.add(k);
  }
  const parsed: RateRow[] = rows.map((r) => ({
    gpuClass: r.gpuClass,
    lane: r.lane as RateRow['lane'],
    unitKind: r.unitKind as RateRow['unitKind'],
    providerMicrosPerUnit: BigInt(r.providerMicrosPerUnit),
    buyerMicrosPerUnit: BigInt(r.buyerMicrosPerUnit),
  }));
  const before = (await rateCardFor(day)).map(rowToJson);
  await setRateCard(day, parsed, now); // rejects today and earlier
  await audit(actor, 'admin.rate_card.put', day, { before, after: rows });
  return { day, rows: (await rateCardFor(day)).map(rowToJson) };
}

// ---- models ---------------------------------------------------------------------------------------

async function listModelsRaw() {
  const rows = await dbRef.db.select().from(modelsTable);
  if (rows.length > 0) return rows;
  // empty table: the gateway/hub use the default catalog, so show (and seed on PUT) exactly that
  return DEFAULT_CATALOG.map((m) => ({
    id: m.id,
    family: m.family,
    engineIds: m.engineIds,
    hfTokenizer: m.hfTokenizer,
    kind: m.kind,
    minVramGb: Math.ceil(m.minVramMb / 1024),
    lanes: m.lanes,
    enabled: true,
    unitKind: m.unitKind,
  }));
}

export async function getModels() {
  return (await listModelsRaw())
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({
      id: m.id,
      enabled: m.enabled,
      family: m.family ?? m.id,
      kind: m.kind ?? 'chat',
      lanes: m.lanes ?? ['open'],
      unitKind: m.unitKind ?? 'tokens_1m',
    }));
}

export async function putModels(
  input: { id: string; enabled: boolean }[],
  actor: string,
  deps: Pick<AdminDeps, 'refreshCatalog'> = defaultAdminDeps,
) {
  const current = await listModelsRaw();
  const known = new Map(current.map((m) => [m.id, m]));
  for (const m of input) if (!known.has(m.id)) throw new AppError('VALIDATION', `Unknown model ${m.id}.`);
  const next = new Map(current.map((m) => [m.id, m.enabled]));
  for (const m of input) next.set(m.id, m.enabled);
  if (![...next.values()].some(Boolean))
    throw new AppError('VALIDATION', 'At least one model must stay enabled.');
  const before = Object.fromEntries(current.map((m) => [m.id, m.enabled]));
  await dbRef.db.transaction(async (tx) => {
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(modelsTable);
    if ((n?.n ?? 0) === 0)
      await tx.insert(modelsTable).values(
        DEFAULT_CATALOG.map((m) => ({
          id: m.id,
          family: m.family,
          engineIds: m.engineIds,
          hfTokenizer: m.hfTokenizer,
          kind: m.kind,
          minVramGb: Math.ceil(m.minVramMb / 1024),
          lanes: m.lanes,
          enabled: true,
          unitKind: m.unitKind,
        })),
      );
    for (const on of [true, false]) {
      const ids = input.filter((m) => m.enabled === on).map((m) => m.id);
      if (ids.length > 0)
        await tx.update(modelsTable).set({ enabled: on }).where(inArray(modelsTable.id, ids));
    }
  });
  await audit(actor, 'admin.models.put', 'models', { before, changes: input });
  try {
    await deps.refreshCatalog();
  } catch (err) {
    logger.warn({ err: String(err) }, 'admin: refreshCatalog failed after models change');
  }
  return getModels();
}

// ---- house node -----------------------------------------------------------------------------------

/** Mark/unmark a node as the house node. Marking requires the node to be owned by HOUSE_OWNER_ADDRESS. */
export async function setNodeHouse(
  id: string,
  isHouse: boolean,
  who: string,
  deps: AdminDeps = defaultAdminDeps,
) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'Node not found.');
  const [node] = await dbRef.db.select().from(nodes).where(eq(nodes.id, id));
  if (!node) throw new AppError('NOT_FOUND', 'Node not found.');
  if (isHouse) {
    const houseOwner = (deps.houseOwner ? deps.houseOwner() : config.HOUSE_OWNER_ADDRESS)?.toLowerCase();
    if (!houseOwner || node.owner.toLowerCase() !== houseOwner)
      throw new AppError('VALIDATION', 'Only a node owned by HOUSE_OWNER_ADDRESS can be the house node.');
  }
  await dbRef.db.update(nodes).set({ isHouse }).where(eq(nodes.id, id));
  await audit(who, 'admin.node.house', id, { isHouse, previous: node.isHouse, owner: node.owner });
  return { id, isHouse };
}
