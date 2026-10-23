import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { config } from '../../config';
import { claims, earningEvents, epochBalances, epochs, nodes } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { dbRef } from '../auth/constants';

/** A posted root becomes claimable this long after posting (contracts-spec: 1 h). */
export const CLAIM_DELAY_MS = 3_600_000;

export const meteringSettings = {
  epochSeconds: config.EPOCH_SECONDS,
  minClaimMicros: BigInt(config.CLAIM_MIN_USDG_MICROS),
};

const big = (v: unknown): bigint =>
  BigInt(v === null || v === undefined ? 0 : (v as string | number | bigint));

export async function earningsSummary(owner: string, now: Date = new Date()) {
  const o = owner.toLowerCase();
  const db = dbRef.db;
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<string>`coalesce(sum(${earningEvents.usdgMicros}), 0)` })
    .from(earningEvents)
    .where(eq(earningEvents.owner, o));
  const [{ claimed } = { claimed: 0 }] = await db
    .select({ claimed: sql<string>`coalesce(sum(${claims.amountUsdgMicros}), 0)` })
    .from(claims)
    .where(and(eq(claims.owner, o), eq(claims.status, 'confirmed')));
  const [latest] = await db
    .select()
    .from(epochs)
    .where(eq(epochs.status, 'posted'))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  // the newest posted root that is already past the claim delay
  const [claimableEpoch] = await db
    .select()
    .from(epochs)
    .where(and(eq(epochs.status, 'posted'), lte(epochs.postedAt, new Date(now.getTime() - CLAIM_DELAY_MS))))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  let cumulative = 0n;
  if (claimableEpoch) {
    const [bal] = await db
      .select({ c: epochBalances.cumulativeUsdgMicros })
      .from(epochBalances)
      .where(and(eq(epochBalances.owner, o), eq(epochBalances.epoch, claimableEpoch.epoch)));
    cumulative = bal?.c ?? 0n;
  }
  const totalEarned = big(total);
  const claimedMicros = big(claimed);
  const claimable = cumulative > claimedMicros ? cumulative - claimedMicros : 0n;
  const pending = totalEarned > cumulative ? totalEarned - cumulative : 0n;
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      online: sql<number>`count(*) filter (where ${nodes.status} in ('online','busy'))::int`,
    })
    .from(nodes)
    .where(eq(nodes.owner, o));
  const periodMs = meteringSettings.epochSeconds * 1000;
  const claimableAtMs = latest?.postedAt ? latest.postedAt.getTime() + CLAIM_DELAY_MS : null;
  return {
    totalEarnedMicros: totalEarned.toString(),
    claimedMicros: claimedMicros.toString(),
    claimableMicros: claimable.toString(),
    pendingMicros: pending.toString(),
    latestEpoch: latest ? Number(latest.epoch) : null,
    nextEpochAt: new Date((Math.floor(now.getTime() / periodMs) + 1) * periodMs).toISOString(),
    claimableAt:
      claimableAtMs !== null && claimableAtMs > now.getTime() ? new Date(claimableAtMs).toISOString() : null,
    minClaimMicros: meteringSettings.minClaimMicros.toString(),
    nodes: { total: counts?.total ?? 0, online: counts?.online ?? 0 },
  };
}

export type SeriesRange = '7d' | '30d' | '90d';
const RANGE_DAYS: Record<SeriesRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Hourly buckets for 7d, daily for 30d/90d. `canary_withhold` is folded into `slashMicros`. */
export async function earningsSeries(owner: string, range: SeriesRange, now: Date = new Date()) {
  const o = owner.toLowerCase();
  const from = new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
  const interval = range === '7d' ? sql`interval '1 hour'` : sql`interval '1 day'`;
  const rows = await dbRef.db.execute<{ bucket: Date; job: string; floor: string; slash: string }>(sql`
    select time_bucket(${interval}, ts) as bucket,
      coalesce(sum(usdg_micros) filter (where kind = 'job'), 0)::text as job,
      coalesce(sum(usdg_micros) filter (where kind = 'floor'), 0)::text as floor,
      coalesce(sum(usdg_micros) filter (where kind in ('slash','canary_withhold')), 0)::text as slash
    from earning_events
    where owner = ${o} and ts >= ${from.toISOString()}::timestamptz and ts <= ${now.toISOString()}::timestamptz
    group by 1 order by 1`);
  return {
    buckets: [...rows].map((r) => ({
      ts: new Date(r.bucket).toISOString(),
      jobMicros: r.job,
      floorMicros: r.floor,
      slashMicros: r.slash,
    })),
  };
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const TS_KEY = sql`to_char(ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type LedgerRow = {
  ts_key: string;
  node_id: string;
  job_id: string | null;
  kind: string;
  usdg_micros: string;
  epoch: string | null;
};

const ledgerId = (r: LedgerRow) => `${r.ts_key}|${r.node_id}|${r.kind}|${r.job_id ?? ''}`;

function parseLedgerCursor(cursor: string | undefined): [string, string, string, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as unknown;
    if (!Array.isArray(v) || v.length !== 4 || v.some((x) => typeof x !== 'string')) throw new Error();
    return v as [string, string, string, string];
  } catch {
    throw new AppError('VALIDATION', 'Invalid cursor.');
  }
}

/** Newest first; keyset pagination over (ts, node_id, kind, job_id). */
export async function earningsLedger(owner: string, q: { cursor?: string; limit: number }) {
  const o = owner.toLowerCase();
  const cur = parseLedgerCursor(q.cursor);
  const after = cur
    ? sql`and (ts, node_id, kind, coalesce(job_id, ${NIL_UUID}::uuid)) < (${cur[0]}::timestamptz, ${cur[1]}::uuid, ${cur[2]}, ${cur[3] || NIL_UUID}::uuid)`
    : sql``;
  const rows = [
    ...(await dbRef.db.execute<LedgerRow>(sql`
    select ${TS_KEY} as ts_key, node_id, job_id, kind, usdg_micros::text as usdg_micros, epoch::text as epoch
    from earning_events where owner = ${o} ${after}
    order by ts desc, node_id desc, kind desc, coalesce(job_id, ${NIL_UUID}::uuid) desc
    limit ${q.limit + 1}`)),
  ];
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: ledgerId(r),
      ts: r.ts_key.replace(/\d{3}Z$/, 'Z'),
      nodeId: r.node_id,
      jobId: r.job_id,
      kind: r.kind as 'job' | 'floor' | 'slash' | 'canary_withhold',
      micros: r.usdg_micros,
      epoch: r.epoch === null ? null : Number(r.epoch),
    })),
    nextCursor:
      rows.length > q.limit && last
        ? Buffer.from(JSON.stringify([last.ts_key, last.node_id, last.kind, last.job_id ?? ''])).toString(
            'base64url',
          )
        : null,
  };
}

/**
 * One CSV cell. Text starting with `= + - @` (or tab / CR) is prefixed with `'` so spreadsheets do not
 * evaluate it as a formula; then quoted when it contains a comma, quote or newline. Numeric cells
 * (bigint / number) are written as is.
 */
export function csvCell(v: string | number | bigint | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const STATEMENT_HEADER = 'ts,node_id,job_id,kind,usdg_micros,epoch';

export async function statementCsv(owner: string, from?: Date, to?: Date): Promise<string> {
  const o = owner.toLowerCase();
  const lo = from ? sql`and ts >= ${from.toISOString()}::timestamptz` : sql``;
  const hi = to ? sql`and ts <= ${to.toISOString()}::timestamptz` : sql``;
  const rows = await dbRef.db.execute<LedgerRow>(sql`
    select ${TS_KEY} as ts_key, node_id, job_id, kind, usdg_micros::text as usdg_micros, epoch::text as epoch
    from earning_events where owner = ${o} ${lo} ${hi} order by ts asc, node_id, kind, job_id`);
  const lines = [STATEMENT_HEADER];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.ts_key),
        csvCell(r.node_id),
        csvCell(r.job_id),
        csvCell(r.kind),
        csvCell(BigInt(r.usdg_micros)),
        csvCell(r.epoch === null ? null : BigInt(r.epoch)),
      ].join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
