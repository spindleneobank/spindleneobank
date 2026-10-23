import type { Lane, UnitKind } from '../../shared/enums';
import { mulDivCeil } from '../gateway/pricing';

export interface RateRow {
  gpuClass: number;
  lane: Lane;
  unitKind: UnitKind;
  providerMicrosPerUnit: bigint;
  buyerMicrosPerUnit: bigint;
}

/**
 * PLACEHOLDER provider rates (owner review needed), USDG micros per unit.
 * `tokens_1m` is per 1,000,000 tokens; `image` is per image.
 */
export const DEFAULT_TOKEN_RATES_MICROS: Record<number, bigint> = {
  0: 20_000n, // 0.02 USDG / 1M tokens
  1: 50_000n,
  2: 100_000n,
  3: 400_000n,
  4: 600_000n,
};
export const DEFAULT_IMAGE_RATE_MICROS = 4_000n; // 0.004 USDG / image

/** buyer = provider * 10000 / 8000, rounded up, so the 80% provider share never exceeds the rate. */
export const buyerFromProvider = (provider: bigint): bigint => mulDivCeil(provider, 10_000n, 8_000n);

/**
 * Initial card: open lane for every class (tokens and images); sealed lane tokens for the CC-capable
 * classes 3-4 only (same price as open until the owner sets a sealed premium).
 */
export function defaultRateRows(): RateRow[] {
  const rows: RateRow[] = [];
  const add = (gpuClass: number, lane: Lane, unitKind: UnitKind, provider: bigint) =>
    rows.push({
      gpuClass,
      lane,
      unitKind,
      providerMicrosPerUnit: provider,
      buyerMicrosPerUnit: buyerFromProvider(provider),
    });
  for (const [cls, rate] of Object.entries(DEFAULT_TOKEN_RATES_MICROS)) {
    add(Number(cls), 'open', 'tokens_1m', rate);
    add(Number(cls), 'open', 'image', DEFAULT_IMAGE_RATE_MICROS);
    if (Number(cls) >= 3) add(Number(cls), 'sealed', 'tokens_1m', rate);
  }
  return rows;
}
