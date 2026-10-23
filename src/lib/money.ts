/** USDG money helpers. Amounts are bigint micros internally and decimal integer strings at the API edge. */

export function parseMicros(s: string, opts: { signed?: boolean } = {}): bigint {
  const re = opts.signed ? /^-?\d+$/ : /^\d+$/;
  if (typeof s !== 'string' || !re.test(s)) throw new RangeError('invalid micros amount');
  return BigInt(s);
}

export function formatMicros(b: bigint): string {
  return b.toString(10);
}

/** floor(a * b / c) */
export function mulDivDown(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError('division by zero');
  return (a * b) / c;
}

/** floor(amount * bps / 10_000) */
export function bpsOf(amount: bigint, bps: bigint | number): bigint {
  return mulDivDown(amount, BigInt(bps), 10_000n);
}
