import { z } from 'zod';

/** USDG money helpers. Amounts are bigint micros internally and decimal integer strings at the API edge. */

export const USDG_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDG_DECIMALS);

/** Non-negative integer micros as a decimal string (<= 78 digits, the uint256 range). */
export const MicrosString = z.string().regex(/^\d{1,78}$/, 'expected a non-negative integer string');
export type MicrosString = z.infer<typeof MicrosString>;

export const SignedMicrosString = z.string().regex(/^-?\d{1,78}$/, 'expected an integer string');
export type SignedMicrosString = z.infer<typeof SignedMicrosString>;

/** "12.5" -> 12500000n. Rejects negatives, exponents and more than 6 decimal places. */
export function toMicros(usdg: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usdg);
  if (!m) throw new RangeError(`invalid USDG amount: ${usdg}`);
  const frac = (m[2] ?? '').padEnd(USDG_DECIMALS, '0');
  return BigInt(m[1] as string) * SCALE + BigInt(frac || '0');
}

/** 12500000n -> "12.5" (negative values keep the sign). */
export function fromMicros(b: bigint): string {
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(USDG_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** USD cents -> USDG micros (1 cent = 10_000 micros). */
export function centsToMicros(cents: bigint): bigint {
  return cents * 10_000n;
}

/** USDG micros -> USD cents, floored. */
export function microsToCents(micros: bigint): bigint {
  return micros / 10_000n;
}

export function parseMicros(s: string, opts: { signed?: boolean } = {}): bigint {
  const re = opts.signed ? /^-?\d{1,78}$/ : /^\d{1,78}$/;
  if (typeof s !== 'string' || !re.test(s)) throw new RangeError('invalid micros amount');
  return BigInt(s);
}

export function formatMicros(b: bigint): string {
  return b.toString(10);
}

/** floor(a * b / c) for non-negative operands. */
export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError('division by zero');
  return (a * b) / c;
}
export const mulDivDown = mulDivFloor;

/** floor(amount * bps / 10_000) */
export function bpsOf(amount: bigint, bps: bigint | number): bigint {
  return mulDivFloor(amount, BigInt(bps), 10_000n);
}
