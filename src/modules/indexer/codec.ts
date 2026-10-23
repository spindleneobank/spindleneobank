/** JSON-safe encoding that round-trips bigint and Date (journal undo data, pending events). */
export function enc(v: unknown): unknown {
  if (typeof v === 'bigint') return { $b: v.toString() };
  if (v instanceof Date) return { $d: v.toISOString() };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
  return v;
}

export function dec(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$b === 'string') return BigInt(o.$b);
    if (typeof o.$d === 'string') return new Date(o.$d);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, dec(x)]));
  }
  return v;
}
