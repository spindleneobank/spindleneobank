import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { buyerLedger, cardOperations, earningEvents, nodes, x402Payments } from '../../db/schema';
import { dbRef } from '../auth/constants';
import { floorSettings } from '../floor/service';

const DAY_MS = 86_400_000;
/** Kill thresholds from the Overview (section 7). Spend in USDG micros. */
export const KILL = {
  day14: { liveNodes: 150, sealedNodes: 25 },
  day30: { spendMicros: 15_000_000_000n, cardStockBps: 3000 },
  day60: { floorShareMaxBps: 2000 },
} as const;

export type KillMetrics = {
  liveNodes: number;
  sealedNodes: number;
  /** Net buyer charges (prepaid ledger) plus settled x402 usage, last 30 d. */
  buyerSpend30dMicros: bigint;
  /** null = n/a: claim transactions are not traced to card/stock destinations (see `cardStockNote`). */
  cardStockShareBps: number | null;
  cardStockNote: string;
  floorShareBps: number;
  providerPayouts30dMicros: bigint;
  floorPayouts30dMicros: bigint;
};

export async function computeKillMetrics(now = new Date()): Promise<KillMetrics> {
  const db = dbRef.db;
  const since24 = new Date(now.getTime() - DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);

  const [live] = await db
    .select({
      live: sql<number>`count(*)::int`,
      sealed: sql<number>`count(*) filter (where ${nodes.lane} = 'sealed')::int`,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.isHouse, false),
        sql`${nodes.status} not in ('suspended','deactivated')`,
        gte(nodes.lastSeenAt, since24),
      ),
    );

  const [ledger] = await db
    .select({ s: sql<string>`coalesce(-sum(${buyerLedger.usdgMicros}), 0)` })
    .from(buyerLedger)
    .where(and(inArray(buyerLedger.kind, ['charge', 'refund']), gte(buyerLedger.createdAt, since30)));
  const [x402] = await db
    .select({ s: sql<string>`coalesce(sum(${x402Payments.usedMicros}), 0)` })
    .from(x402Payments)
    .where(
      and(
        eq(x402Payments.status, 'settled'),
        sql`coalesce(${x402Payments.closedAt}, ${x402Payments.createdAt}) >= ${since30.toISOString()}::timestamptz`,
      ),
    );

  const [pay] = await db
    .select({
      total: sql<string>`coalesce(sum(${earningEvents.usdgMicros}) filter (where ${earningEvents.kind} in ('job','floor') and ${earningEvents.usdgMicros} > 0), 0)`,
      floor: sql<string>`coalesce(sum(${earningEvents.usdgMicros}) filter (where ${earningEvents.kind} = 'floor' and ${earningEvents.usdgMicros} > 0), 0)`,
    })
    .from(earningEvents)
    .where(gte(earningEvents.ts, since30));
  const total = BigInt(pay?.total ?? '0');
  const floor = BigInt(pay?.floor ?? '0');

  return {
    liveNodes: live?.live ?? 0,
    sealedNodes: live?.sealed ?? 0,
    buyerSpend30dMicros: BigInt(ledger?.s ?? '0') + BigInt(x402?.s ?? '0'),
    cardStockShareBps: null,
    cardStockNote:
      'n/a: claims are plain USDG transfers to the owner wallet; card top-ups and stock swaps are funded from the wallet afterwards and cannot be attributed to a claim.',
    floorShareBps: total === 0n ? 0 : Number((floor * 10_000n) / total),
    providerPayouts30dMicros: total,
    floorPayouts30dMicros: floor,
  };
}

export type KillCheck = {
  id: string;
  day: number;
  label: string;
  value: string | null;
  threshold: string;
  /** Due once `day` days have passed since launch (FLOOR_START_DATE). */
  due: boolean;
  /** null when not measurable (n/a). */
  met: boolean | null;
};

/** Evaluates the Overview kill criteria; launch day = FLOOR_START_DATE (day 0). */
export function evaluateKill(
  m: KillMetrics,
  now = new Date(),
  startDate = floorSettings.startDate,
): KillCheck[] {
  const age = startDate ? Math.floor((now.getTime() - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS) : null;
  const due = (d: number) => age !== null && age >= d;
  const usd = (micros: bigint) => `${micros / 1_000_000n} USDG`;
  return [
    {
      id: 'live-nodes',
      day: 14,
      label: 'Live nodes',
      value: String(m.liveNodes),
      threshold: `>= ${KILL.day14.liveNodes}`,
      due: due(14),
      met: m.liveNodes >= KILL.day14.liveNodes,
    },
    {
      id: 'sealed-nodes',
      day: 14,
      label: 'Sealed nodes',
      value: String(m.sealedNodes),
      threshold: `>= ${KILL.day14.sealedNodes}`,
      due: due(14),
      met: m.sealedNodes >= KILL.day14.sealedNodes,
    },
    {
      id: 'buyer-spend-30d',
      day: 30,
      label: 'Buyer spend (30 d)',
      value: usd(m.buyerSpend30dMicros),
      threshold: `>= ${usd(KILL.day30.spendMicros)}`,
      due: due(30),
      met: m.buyerSpend30dMicros >= KILL.day30.spendMicros,
    },
    {
      id: 'card-stock-share',
      day: 30,
      label: 'Claims to card or stocks',
      value: m.cardStockShareBps === null ? null : `${m.cardStockShareBps / 100}%`,
      threshold: `>= ${KILL.day30.cardStockBps / 100}%`,
      due: due(30),
      met: m.cardStockShareBps === null ? null : m.cardStockShareBps >= KILL.day30.cardStockBps,
    },
    {
      id: 'floor-share',
      day: 60,
      label: 'Floor share of payouts (30 d)',
      value: `${m.floorShareBps / 100}%`,
      threshold: `< ${KILL.day60.floorShareMaxBps / 100}%`,
      due: due(60),
      met: m.floorShareBps < KILL.day60.floorShareMaxBps,
    },
  ];
}

export async function cardReviewCount(): Promise<number> {
  const [r] = await dbRef.db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardOperations)
    .where(eq(cardOperations.status, 'review'));
  return r?.n ?? 0;
}
