import type { Abi, AbiParameter } from 'viem';

/** Parse a user-typed decimal ("12.5") into base units; null when empty/invalid/too precise. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [whole = '0', frac = ''] = s.split('.');
  if (frac.length > decimals) return null;
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Base units -> trimmed decimal string, bigint math only. */
export function formatUnitsTrim(value: bigint, decimals: number, maxFraction = 6): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
  if (decimals === 0) frac = '';
  return `${neg ? '-' : ''}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

function revive(
  param: Pick<AbiParameter, 'type'> & { components?: readonly AbiParameter[] },
  v: unknown,
): unknown {
  const { type } = param;
  if (type.endsWith(']')) {
    const inner = { ...param, type: type.slice(0, type.lastIndexOf('[')) };
    return (v as unknown[]).map((x) => revive(inner, x));
  }
  if (type === 'tuple') {
    const comps = param.components ?? [];
    if (Array.isArray(v)) return comps.map((c, i) => revive(c, v[i]));
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(comps.map((c) => [c.name ?? '', revive(c, obj[c.name ?? ''])]));
  }
  if (/^u?int\d*$/.test(type)) return BigInt(v as string | number);
  return v;
}

/**
 * The API returns call args as JSON (numbers as decimal strings). Convert them to what viem expects
 * (bigint for every intN/uintN, recursively through tuples and arrays) using the known ABI.
 */
export function reviveArgs(abi: Abi, functionName: string, args: readonly unknown[]): unknown[] {
  const fn = abi.find((i) => i.type === 'function' && i.name === functionName);
  if (!fn || fn.type !== 'function') throw new Error(`Unknown function ${functionName}`);
  return fn.inputs.map((p, i) => revive(p, args[i]));
}
