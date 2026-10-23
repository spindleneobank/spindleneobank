import { erc20Abi, spindleClaimsAbi } from '@spindle/shared/abi';
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { config } from '../../config';
import {
  auditLog,
  canaryResults,
  earningEvents,
  epochs,
  floorPayments,
  kv,
  nodeAttestations,
  nodes,
} from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { publicClient } from '../../lib/viem';
import { dbRef } from '../auth/constants';
import { closedEpochAt, epochEnd, epochSettings } from '../epochs/service';
import { onlineMinutes } from './availability';

const DAY_MS = 86_400_000;
const BPS = 10_000n;

/** Runtime settings (config is frozen; tests override). */
export const floorSettings = {
  startDate: config.FLOOR_START_DATE as string | undefined,
  epochBudgetMicros: BigInt(config.FLOOR_EPOCH_BUDGET_MICROS),
  nodeCapMicros: BigInt(config.FLOOR_NODE_CAP_MICROS),
  days: config.FLOOR_DAYS,
  /** Minutes (of a 60 min hour) a node must be seen online. Scaled when EPOCH_SECONDS differs. */
  minOnlineMinutes: 50,
};

export const ALERT_KEY = 'floor:alert';
const AVAIL_TTL_S = 3 * 86_400;
/** A sealed-lane node needs an attestation this fresh to count as available. */
export const SEALED_ATTEST_MAX_AGE_MS = 25 * 3_600_000;

// ---- decay ----------------------------------------------------------------------------------------

/** Whole days since the floor start at `at` (negative before it); null when the floor is disabled. */
export function floorDay(at: Date, startDate = floorSettings.startDate): number | null {
  if (!startDate) return null;
  return Math.floor((at.getTime() - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS);
}

/** Linear decay in basis points: 10000 at day 0, 0 from `days` on (and before the start). Integer math. */
export function decayBps(day: number | null, days = floorSettings.days): number {
  if (day === null || day < 0 || day >= days) return 0;
  return 10_000 - Math.floor((day * 10_000) / days);
}

/** Total budget for the epoch starting at `epochStart`, in micros. */
export function epochBudget(epochStart: Date, s = floorSettings): bigint {
  const bps = decayBps(floorDay(epochStart, s.startDate), s.days);
  return (s.epochBudgetMicros * BigInt(bps)) / BPS;
}

export const epochStartOf = (epoch: bigint): Date =>
  new Date(Number(epoch) * epochSettings.epochSeconds * 1000);

export { availKey, markAvailable, onlineMinutes } from './availability';

/** Minutes required in an epoch of the configured length (50 of 60 by default). */
export function requiredMinutes(s = floorSettings): number {
  const minutes = Math.max(1, Math.floor(epochSettings.epochSeconds / 60));
  return Math.min(minutes, Math.ceil((minutes * s.minOnlineMinutes) / 60));
}

// ---- solvency -------------------------------------------------------------------------------------

export interface FloorChain {
  poolBalance(): Promise<bigint>;
  totalClaimed(): Promise<bigint>;
}

export const defaultFloorChain: FloorChain = {
  poolBalance: () =>
    publicClient.readContract({
      address: requireAddress('usdg'),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [requireAddress('claims')],
    }) as Promise<bigint>,
  totalClaimed: () =>
    publicClient.readContract({
      address: requireAddress('claims'),
      abi: spindleClaimsAbi,
      functionName: 'totalClaimed',
    }) as Promise<bigint>,
};

/**
 * What the claims contract will owe once everything recorded so far is posted:
 * latest non-vetoed root total + positive events not yet in a live root, minus what was claimed.
 */
export async function committedEarned(): Promise<bigint> {
  const db = dbRef.db;
  const [top] = await db
    .select({ t: epochs.totalEarnedUsdgMicros })
    .from(epochs)
    .where(ne(epochs.status, 'vetoed'))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  const vetoed = db.select({ e: epochs.epoch }).from(epochs).where(eq(epochs.status, 'vetoed'));
  const [pending] = await db
    .select({ s: sql<string>`coalesce(sum(${earningEvents.usdgMicros}), 0)` })
    .from(earningEvents)
    .where(
      and(
        sql`${earningEvents.usdgMicros} > 0`,
        or(isNull(earningEvents.epoch), inArray(earningEvents.epoch, vetoed)),
      ),
    );
  return (top?.t ?? 0n) + BigInt(pending?.s ?? '0');
}

export type Solvency = {
  poolMicros: bigint;
  claimedMicros: bigint;
  earnedMicros: bigint;
  owedMicros: bigint;
  /** pool − owed; negative = the treasury must top up this much. */
  headroomMicros: bigint;
};

export async function solvency(chain: FloorChain = defaultFloorChain): Promise<Solvency> {
  const [pool, claimed, earned] = await Promise.all([
    chain.poolBalance(),
    chain.totalClaimed(),
    committedEarned(),
  ]);
  const owed = earned > claimed ? earned - claimed : 0n;
  return {
    poolMicros: pool,
    claimedMicros: claimed,
    earnedMicros: earned,
    owedMicros: owed,
    headroomMicros: pool - owed,
  };
}

// ---- eligibility ----------------------------------------------------------------------------------

export interface FloorDeps {
  chain: FloorChain;
  minutes(nodeId: string, epoch: bigint): Promise<number>;
  now(): Date;
}
export const defaultFloorDeps = (): FloorDeps => ({
  chain: defaultFloorChain,
  minutes: (n, e) => onlineMinutes(n, e),
  now: () => new Date(),
});

/** Registered, non-house, non-suspended nodes with no canary failure in the epoch and enough online minutes. */
export async function eligibleNodes(epoch: bigint, minutes: FloorDeps['minutes']) {
  const start = epochStartOf(epoch);
  const end = epochEnd(epoch);
  const db = dbRef.db;
  const houseOwner = config.HOUSE_OWNER_ADDRESS?.toLowerCase();
  const rows = await db
    .select({ id: nodes.id, owner: nodes.owner, lane: nodes.lane, attestAt: nodes.lastAttestAt })
    .from(nodes)
    .where(
      and(
        eq(nodes.registered, true),
        sql`${nodes.onchainId} is not null`,
        eq(nodes.isHouse, false),
        sql`${nodes.status} not in ('suspended','deactivated')`,
        lt(nodes.createdAt, end),
      ),
    );
  const failed = new Set(
    (
      await db
        .selectDistinct({ id: canaryResults.nodeId })
        .from(canaryResults)
        .where(
          and(
            eq(canaryResults.pass, false),
            gte(canaryResults.createdAt, start),
            lt(canaryResults.createdAt, end),
          ),
        )
    ).map((r) => r.id),
  );
  const verifiedAttest = new Map(
    (
      await db
        .select({ id: nodeAttestations.nodeId, at: sql<Date>`max(${nodeAttestations.createdAt})` })
        .from(nodeAttestations)
        .where(eq(nodeAttestations.verified, true))
        .groupBy(nodeAttestations.nodeId)
    ).map((r) => [r.id, new Date(r.at).getTime()]),
  );
  const need = requiredMinutes();
  const out: { id: string; owner: string }[] = [];
  for (const n of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    if (houseOwner && n.owner === houseOwner) continue;
    if (failed.has(n.id)) continue;
    if (n.lane === 'sealed') {
      const at = Math.max(n.attestAt?.getTime() ?? 0, verifiedAttest.get(n.id) ?? 0);
      if (at < end.getTime() - SEALED_ATTEST_MAX_AGE_MS) continue;
    }
    if ((await minutes(n.id, epoch)) < need) continue;
    out.push({ id: n.id, owner: n.owner });
  }
  return out;
}

// ---- apply ----------------------------------------------------------------------------------------

export type FloorResult =
  | {
      kind: 'paid';
      epoch: bigint;
      nodes: number;
      paidMicros: bigint;
      budgetMicros: bigint;
      perNodeMicros: bigint;
    }
  | { kind: 'skipped'; epoch: bigint; reason: 'disabled' | 'zero-budget' | 'no-eligible' | 'already-applied' }
  | { kind: 'insolvent'; epoch: bigint; neededMicros: bigint; shortfallMicros: bigint };

const fmtUsdg = (m: bigint) => `${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, '0')}`;

export async function raiseFloorAlert(epoch: bigint, neededMicros: bigint, shortfallMicros: bigint) {
  const details = {
    epoch: epoch.toString(),
    reason: 'insolvent',
    neededMicros: neededMicros.toString(),
    shortfallMicros: shortfallMicros.toString(),
    message: `treasury top-up needed: ${fmtUsdg(shortfallMicros)} USDG`,
  };
  logger.error(details, 'floor skipped: claims pool would be insolvent');
  const [cur] = await dbRef.db.select().from(kv).where(eq(kv.key, ALERT_KEY));
  const prev = cur?.value as { epoch?: string } | undefined;
  const value = { ...details, at: new Date().toISOString() };
  await dbRef.db
    .insert(kv)
    .values({ key: ALERT_KEY, value })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });
  if (prev?.epoch !== details.epoch)
    await dbRef.db
      .insert(auditLog)
      .values({ actor: 'system:floor', action: 'floor.skipped', subject: details.epoch, details });
}

/**
 * Pays the availability floor for hour-epoch `epoch` (idempotent). Events are written unassigned
 * (`epoch` null, ts inside the hour) so the next epoch build picks them up before cumulatives are computed.
 * All-or-nothing: if the pool cannot cover the full payout the floor is skipped and an alert is raised.
 */
export async function applyFloor(epoch: bigint, deps: FloorDeps = defaultFloorDeps()): Promise<FloorResult> {
  const budget = epochBudget(epochStartOf(epoch));
  if (!floorSettings.startDate) return { kind: 'skipped', epoch, reason: 'disabled' };
  if (budget === 0n) return { kind: 'skipped', epoch, reason: 'zero-budget' };
  const db = dbRef.db;
  const [done] = await db
    .select({ n: floorPayments.nodeId })
    .from(floorPayments)
    .where(eq(floorPayments.epoch, epoch))
    .limit(1);
  if (done) return { kind: 'skipped', epoch, reason: 'already-applied' };

  const eligible = await eligibleNodes(epoch, deps.minutes);
  if (eligible.length === 0) return { kind: 'skipped', epoch, reason: 'no-eligible' };
  const share = budget / BigInt(eligible.length);
  const per = share < floorSettings.nodeCapMicros ? share : floorSettings.nodeCapMicros;
  if (per === 0n) return { kind: 'skipped', epoch, reason: 'zero-budget' };
  const total = per * BigInt(eligible.length);

  const s = await solvency(deps.chain);
  if (s.headroomMicros < total) {
    const shortfall = total - s.headroomMicros;
    await raiseFloorAlert(epoch, total, shortfall);
    return { kind: 'insolvent', epoch, neededMicros: total, shortfallMicros: shortfall };
  }

  const ts = new Date(epochEnd(epoch).getTime() - 1);
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(floorPayments)
      .values(eligible.map((n) => ({ epoch, nodeId: n.id, usdgMicros: per })))
      .onConflictDoNothing()
      .returning({ nodeId: floorPayments.nodeId });
    const ok = new Set(rows.map((r) => r.nodeId));
    const evs = eligible.filter((n) => ok.has(n.id));
    if (evs.length > 0)
      await tx
        .insert(earningEvents)
        .values(evs.map((n) => ({ ts, nodeId: n.id, owner: n.owner, kind: 'floor', usdgMicros: per })));
    return evs.length;
  });
  await db.delete(kv).where(eq(kv.key, ALERT_KEY));
  logger.info({ epoch: epoch.toString(), nodes: inserted, perNode: per.toString() }, 'floor applied');
  return {
    kind: 'paid',
    epoch,
    nodes: inserted,
    paidMicros: per * BigInt(inserted),
    budgetMicros: budget,
    perNodeMicros: per,
  };
}

/** Floor for the hour that just closed at `now`. */
export const applyClosedFloor = (now = new Date(), deps?: FloorDeps) =>
  applyFloor(closedEpochAt(now), deps ?? { ...defaultFloorDeps(), now: () => now });

// ---- reporting ------------------------------------------------------------------------------------

export async function floorStatus(now = new Date(), perEpochLimit = 48) {
  const day = floorDay(now);
  const bps = decayBps(day);
  const rows = await dbRef.db
    .select({
      epoch: floorPayments.epoch,
      paid: sql<string>`sum(${floorPayments.usdgMicros})`,
      nodes: sql<number>`count(*)::int`,
    })
    .from(floorPayments)
    .groupBy(floorPayments.epoch)
    .orderBy(desc(floorPayments.epoch))
    .limit(perEpochLimit);
  const [alert] = await dbRef.db.select().from(kv).where(eq(kv.key, ALERT_KEY));
  return {
    enabled: !!floorSettings.startDate,
    startDate: floorSettings.startDate ?? null,
    day,
    days: floorSettings.days,
    decayBps: bps,
    baseBudgetMicros: floorSettings.epochBudgetMicros,
    budgetMicros: (floorSettings.epochBudgetMicros * BigInt(bps)) / BPS,
    nodeCapMicros: floorSettings.nodeCapMicros,
    endsAt: floorSettings.startDate
      ? new Date(
          Date.parse(`${floorSettings.startDate}T00:00:00Z`) + floorSettings.days * DAY_MS,
        ).toISOString()
      : null,
    perEpoch: rows.map((r) => ({ epoch: r.epoch, paidMicros: BigInt(r.paid), nodes: r.nodes })),
    alert: (alert?.value as Record<string, unknown> | undefined) ?? null,
  };
}
