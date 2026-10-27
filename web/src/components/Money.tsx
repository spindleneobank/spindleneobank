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

/**
 * A nonzero amount that would round to zero at `fractionDigits` (e.g. a $0.000003 chat message), split for
 * compact display: `zeros` leading zeros after the point, then the significant `digits` (trailing zeros
 * trimmed). Exact, since micros are the smallest unit. Returns null when normal rounding shows the amount.
 */
export function tinyMicros(
  micros: string | bigint,
  fractionDigits = 2,
): { negative: boolean; zeros: number; digits: string; exact: string } | null {
  const raw = typeof micros === 'bigint' ? micros : BigInt(micros);
  if (raw === 0n || fractionDigits >= MICROS) return null;
  const abs = raw < 0n ? -raw : raw;
  if (abs * 2n >= 10n ** BigInt(MICROS - fractionDigits)) return null; // rounds to a visible amount
  const frac = abs.toString().padStart(MICROS, '0').replace(/0+$/, '');
  const digits = frac.replace(/^0+/, '');
  const zeros = frac.length - digits.length;
  return { negative: raw < 0n, zeros, digits, exact: `${raw < 0n ? '-' : ''}0.${frac}` };
}

/** Plain-text amount for labels and tooltips: like formatMicros, but a tiny nonzero amount shows exactly. */
export function formatMicrosText(micros: string | bigint, fractionDigits = 2): string {
  return tinyMicros(micros, fractionDigits)?.exact ?? formatMicros(micros, { fractionDigits });
}

/** Leading zeros from this count on are compacted as 0.0₅3 instead of 0.000003. */
const COMPACT_ZEROS = 4;

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
  const tiny = tinyMicros(micros, fractionDigits);
  const unitEl = unit ? <span className="sp-money-unit"> {unit}</span> : null;
  if (tiny) {
    const sign = tiny.negative ? '-' : '';
    return (
      <span
        className={`sp-money sp-money-tiny ${className}`}
        data-micros={String(micros)}
        title={`${tiny.exact}${unit ? ` ${unit}` : ''}`}
      >
        {tiny.zeros >= COMPACT_ZEROS ? (
          <>
            {sign}0.0<sub aria-hidden="true">{tiny.zeros}</sub>
            <span className="sp-sr-only">
              {tiny.exact.slice(sign.length + 3, sign.length + 2 + tiny.zeros)}
            </span>
            {tiny.digits}
          </>
        ) : (
          tiny.exact
        )}
        {unitEl}
      </span>
    );
  }
  return (
    <span className={`sp-money ${className}`} data-micros={String(micros)}>
      {formatMicros(micros, { fractionDigits })}
      {unitEl}
    </span>
  );
}
