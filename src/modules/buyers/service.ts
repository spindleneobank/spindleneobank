import { erc20Abi } from '@spindle/shared/abi';
import { and, desc, eq, gt, gte, lt, or, sql } from 'drizzle-orm';
import type { Address } from 'viem';
import { charge, ensureBuyer, release as releaseDb, reserve as reserveDb } from '../../db/balances';
import { buyerLedger, jobs } from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { AppError } from '../../lib/errors';
import { publicClient } from '../../lib/viem';
import { dbRef } from '../auth/constants';

/** Buyer id for a wallet address (upserts the buyer and its zero balance row). */
export async function buyerIdForAddress(address: string): Promise<string> {
  return ensureBuyer(dbRef.db, address.toLowerCase());
}

/**
 * Reserve `maxMicros` of the buyer's balance:
 * `UPDATE buyer_balances SET reserved = reserved + $max WHERE buyer_id=$1 AND balance - reserved >= $max`.
 * Zero rows affected means INSUFFICIENT_BALANCE (402).
 */
export async function reserve(buyerId: string, maxMicros: bigint): Promise<void> {
  const ok = await reserveDb(dbRef.db, buyerId, maxMicros);
  if (!ok) throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient balance for this request.');
}

/**
 * One transaction: `reserved -= reservedMicros`, `balance -= chargeMicros` and a `charge` ledger row.
 * `chargeMicros` is clamped to `reservedMicros` so a settlement can never overdraw the buyer.
 */
export async function settleCharge(
  buyerId: string,
  reservedMicros: bigint,
  chargeMicros: bigint,
  jobId: string,
): Promise<bigint> {
  const final = chargeMicros > reservedMicros ? reservedMicros : chargeMicros;
  await dbRef.db.transaction((tx) => charge(tx, { buyerId, reservedMicros, chargeMicros: final, jobId }));
  return final;
}

/** Give back an unused reservation. */
export async function release(buyerId: string, reservedMicros: bigint): Promise<void> {
  await releaseDb(dbRef.db, buyerId, reservedMicros);
}

// ---- ledger / usage / deposit call ----------------------------------------------------------------

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
function decodeCursor(c: string | undefined): [Date, string] | null {
  if (!c) return null;
  try {
    const [t, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string];
    const d = new Date(t);
    if (Number.isNaN(d.getTime()) || typeof id !== 'string') throw new Error('bad');
    return [d, id];
  } catch {
    throw new AppError('VALIDATION', 'Invalid cursor.');
  }
}

export async function listLedger(address: string, q: { cursor?: string; limit: number }) {
  const buyerId = await buyerIdForAddress(address);
  const cur = decodeCursor(q.cursor);
  const conds = [eq(buyerLedger.buyerId, buyerId)];
  if (cur)
    conds.push(
      or(
        lt(buyerLedger.createdAt, cur[0]),
        and(eq(buyerLedger.createdAt, cur[0]), lt(buyerLedger.id, cur[1])),
      ) as ReturnType<typeof eq>,
    );
  const rows = await dbRef.db
    .select()
    .from(buyerLedger)
    .where(and(...conds))
    .orderBy(desc(buyerLedger.createdAt), desc(buyerLedger.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      kind: r.kind as 'deposit' | 'charge' | 'refund' | 'adjust',
      micros: r.usdgMicros.toString(),
      jobId: r.jobId,
      txHash: r.txHash,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

/** Spend per model/lane and per UTC day over the range (non-canary jobs that billed something). */
export async function usage(address: string, range: keyof typeof RANGE_DAYS, now = new Date()) {
  const buyerId = await buyerIdForAddress(address);
  const since = new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
  const where = and(
    eq(jobs.buyerId, buyerId),
    eq(jobs.isCanary, false),
    gt(jobs.buyerUsdgMicros, 0n),
    gte(jobs.createdAt, since),
  );
  const byModel = await dbRef.db
    .select({
      model: jobs.model,
      lane: jobs.lane,
      jobs: sql<number>`count(*)::int`,
      units: sql<string>`coalesce(sum(${jobs.units}), 0)::text`,
      spent: sql<string>`sum(${jobs.buyerUsdgMicros})::text`,
    })
    .from(jobs)
    .where(where)
    .groupBy(jobs.model, jobs.lane)
    .orderBy(desc(sql`sum(${jobs.buyerUsdgMicros})`));
  const series = await dbRef.db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${jobs.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      jobs: sql<number>`count(*)::int`,
      spent: sql<string>`sum(${jobs.buyerUsdgMicros})::text`,
    })
    .from(jobs)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return {
    byModel: byModel.map((r) => ({
      model: r.model,
      lane: (r.lane ?? 'open') as 'open' | 'sealed',
      jobs: r.jobs,
      units: String(r.units).replace(/\.0+$/, ''),
      spentMicros: r.spent,
    })),
    series: series.map((r) => ({
      ts: `${r.day}T00:00:00.000Z`,
      spentMicros: r.spent,
      jobs: r.jobs,
    })),
  };
}

export interface DepositDeps {
  allowance(owner: Address): Promise<bigint>;
  vault(): Address;
  usdg(): Address;
}
export const defaultDepositDeps: DepositDeps = {
  vault: () => requireAddress('vault'),
  usdg: () => requireAddress('usdg'),
  allowance: (owner) =>
    publicClient.readContract({
      address: requireAddress('usdg'),
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, requireAddress('vault')],
    }) as Promise<bigint>,
};

/** Contract calls for the wallet: `approve` only when the current allowance to the vault is short. */
export async function depositCall(address: string, amountMicros: bigint, deps = defaultDepositDeps) {
  if (amountMicros <= 0n) throw new AppError('VALIDATION', 'Amount must be positive.');
  const vault = deps.vault().toLowerCase();
  const usdg = deps.usdg().toLowerCase();
  const allowance = await deps.allowance(address.toLowerCase() as Address);
  return {
    ...(allowance < amountMicros
      ? { approve: { to: usdg, functionName: 'approve', args: [vault, amountMicros.toString()] } }
      : {}),
    deposit: { to: vault, functionName: 'deposit' as const, args: [amountMicros.toString()] },
  };
}
