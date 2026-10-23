import { and, eq, lt, sql } from 'drizzle-orm';
import { rateCard } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { dbRef } from '../auth/constants';
import { utcDay } from '../gateway/pricing';
import { buyerFromProvider, defaultRateRows, type RateRow } from './defaults';

const DAY_MS = 86_400_000;

export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const toDbRow = (day: string, r: RateRow) => ({
  day,
  gpuClass: r.gpuClass,
  lane: r.lane,
  unitKind: r.unitKind,
  providerUsdgMicrosPerUnit: r.providerMicrosPerUnit,
  buyerUsdgMicrosPerUnit: r.buyerMicrosPerUnit,
});

export async function rateCardFor(day: string = utcDay()): Promise<RateRow[]> {
  const rows = await dbRef.db.select().from(rateCard).where(eq(rateCard.day, day));
  return rows
    .map((r) => ({
      gpuClass: r.gpuClass,
      lane: r.lane as RateRow['lane'],
      unitKind: r.unitKind as RateRow['unitKind'],
      providerMicrosPerUnit: r.providerUsdgMicrosPerUnit,
      buyerMicrosPerUnit: r.buyerUsdgMicrosPerUnit,
    }))
    .sort(
      (a, b) =>
        a.gpuClass - b.gpuClass || a.lane.localeCompare(b.lane) || a.unitKind.localeCompare(b.unitKind),
    );
}

/**
 * Makes sure `day` has a rate card. Missing keys are filled (never overwritten) from the latest earlier
 * day that has rows, or from the placeholder defaults on a fresh database. Insert-only: existing rows,
 * in particular today's, are never touched.
 */
export async function ensureRateCard(day: string): Promise<number> {
  const [prev] = await dbRef.db
    .select({ day: rateCard.day })
    .from(rateCard)
    .where(lt(rateCard.day, day))
    .orderBy(sql`${rateCard.day} desc`)
    .limit(1);
  const source: RateRow[] = prev ? await rateCardFor(prev.day) : defaultRateRows();
  if (source.length === 0) return 0;
  const inserted = await dbRef.db
    .insert(rateCard)
    .values(source.map((r) => toDbRow(day, r)))
    .onConflictDoNothing()
    .returning({ day: rateCard.day });
  return inserted.length;
}

/** Daily rollover: today exists (first boot) and tomorrow is copied from today. */
export async function rolloverRateCard(now: Date = new Date()): Promise<{ today: number; tomorrow: number }> {
  const today = utcDay(now);
  const t = await ensureRateCard(today);
  const tomorrow = await ensureRateCard(addDays(today, 1));
  return { today: t, tomorrow };
}

/**
 * Replaces the rows of a FUTURE day (admin edit of tomorrow's card). Today and earlier days are frozen:
 * this is the only write path besides the insert-only `ensureRateCard`.
 */
export async function setRateCard(day: string, rows: RateRow[], now: Date = new Date()): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError('VALIDATION', 'Invalid day.');
  if (day <= utcDay(now)) throw new AppError('CONFLICT', "Today's rate card is frozen and cannot be edited.");
  for (const r of rows) {
    if (r.providerMicrosPerUnit < 0n || r.buyerMicrosPerUnit < r.providerMicrosPerUnit) {
      throw new AppError('VALIDATION', 'Buyer rate must be at least the provider rate.');
    }
  }
  await dbRef.db.transaction(async (tx) => {
    await tx.delete(rateCard).where(and(eq(rateCard.day, day), sql`${rateCard.day} > ${utcDay(now)}::date`));
    if (rows.length > 0) await tx.insert(rateCard).values(rows.map((r) => toDbRow(day, r)));
  });
}

export { buyerFromProvider };
