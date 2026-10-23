const MICROS = 6;

/**
 * Formats a micro-unit decimal string ("12500000" -> "12.50") with bigint math only. Never uses Number() on
 * micros. Rounds half up at `fractionDigits` (default 2). Handles sign and thousands separators.
 */
export function formatMicros(
  micros: string | bigint,
  { fractionDigits = 2, group = true }: { fractionDigits?: number; group?: boolean } = {},
): string {
  const raw = typeof micros === 'bigint' ? micros : BigInt(micros);
  const negative = raw < 0n;
  let abs = negative ? -raw : raw;
  const drop = MICROS - fractionDigits;
  if (drop > 0) {
    const unit = 10n ** BigInt(drop);
    abs = (abs + unit / 2n) / unit;
  } else if (drop < 0) {
    abs *= 10n ** BigInt(-drop);
  }
  const scale = 10n ** BigInt(Math.max(fractionDigits, 0));
  const whole = abs / scale;
  const frac = abs % scale;
  const wholeStr = group ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole.toString();
  const out = fractionDigits > 0 ? `${wholeStr}.${frac.toString().padStart(fractionDigits, '0')}` : wholeStr;
  return negative && abs !== 0n ? `-${out}` : out;
}

/** USD card amounts are integer cents as strings: "1250" -> "12.50". */
export function formatCents(cents: string | bigint): string {
  return formatMicros(BigInt(cents) * 10_000n);
}

export function Money({
  micros,
  unit = 'USDG',
  fractionDigits = 2,
  className = '',
}: {
  micros: string | bigint;
  unit?: string | null;
  fractionDigits?: number;
  className?: string;
}) {
  return (
    <span className={`sp-money ${className}`} data-micros={String(micros)}>
      {formatMicros(micros, { fractionDigits })}
      {unit ? <span className="sp-money-unit"> {unit}</span> : null}
    </span>
  );
}
