import { and, eq } from 'drizzle-orm';
import { rateCard } from '../../db/schema';
import type { JobKind, Lane, UnitKind } from '../../shared/enums';
import { mulDivFloor } from '../../shared/money';
import { dbRef } from '../auth/constants';

/** Tokens per rate unit (`tokens_1m` rates are micros per 1,000,000 tokens). */
export const TOKENS_PER_UNIT = 1_000_000n;

export interface Rate {
  unitKind: UnitKind;
  /** Buyer price in USDG micros per unit (`tokens_1m`: per 1M tokens; `image`: per image). */
  buyerMicrosPerUnit: bigint;
  providerMicrosPerUnit: bigint;
}

export type MaxChargeEstimate =
  | { kind: 'chat'; promptTokens: number; maxTokens: number }
  | { kind: 'embeddings'; inputTokens: number }
  | { kind: 'images'; n: number };

export type Usage =
  | { kind: 'chat'; promptTokens: number; completionTokens: number }
  | { kind: 'embeddings'; promptTokens: number }
  | { kind: 'images'; images: number };

/** Unit kind a request kind is priced in. */
export const unitKindFor = (kind: JobKind): UnitKind => (kind === 'images' ? 'image' : 'tokens_1m');

export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

/** floor(a*b/c) for non-negative bigints, rounded up instead (used only for reservations). */
export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError('division by zero');
  return (a * b + c - 1n) / c;
}

const toBig = (n: number): bigint => {
  if (!Number.isFinite(n) || n < 0) throw new RangeError('invalid unit count');
  return BigInt(Math.ceil(n));
};

/** Daily rate for (gpu class, lane, unit kind); null when no rate card row exists. */
export async function buyerRate(
  gpuClass: number,
  lane: Lane,
  unitKind: UnitKind,
  day: string = utcDay(),
): Promise<Rate | null> {
  const [row] = await dbRef.db
    .select()
    .from(rateCard)
    .where(
      and(
        eq(rateCard.day, day),
        eq(rateCard.gpuClass, gpuClass),
        eq(rateCard.lane, lane),
        eq(rateCard.unitKind, unitKind),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    unitKind,
    buyerMicrosPerUnit: row.buyerUsdgMicrosPerUnit,
    providerMicrosPerUnit: row.providerUsdgMicrosPerUnit,
  };
}

/** Upper bound to reserve: rounded UP so the reservation always covers `actualCharge`. */
export function maxCharge(est: MaxChargeEstimate, rate: Pick<Rate, 'buyerMicrosPerUnit'>): bigint {
  const r = rate.buyerMicrosPerUnit;
  switch (est.kind) {
    case 'chat':
      return mulDivCeil(toBig(est.promptTokens) + toBig(est.maxTokens), r, TOKENS_PER_UNIT);
    case 'embeddings':
      return mulDivCeil(toBig(est.inputTokens), r, TOKENS_PER_UNIT);
    case 'images':
      return toBig(est.n) * r;
  }
}

/** What the buyer pays for the reported usage; floored, integer micros. */
export function actualCharge(usage: Usage, rate: Pick<Rate, 'buyerMicrosPerUnit'>): bigint {
  const r = rate.buyerMicrosPerUnit;
  switch (usage.kind) {
    case 'chat':
      return mulDivFloor(toBig(usage.promptTokens) + toBig(usage.completionTokens), r, TOKENS_PER_UNIT);
    case 'embeddings':
      return mulDivFloor(toBig(usage.promptTokens), r, TOKENS_PER_UNIT);
    case 'images':
      return toBig(usage.images) * r;
  }
}
