import { describe, expect, it } from 'vitest';
import * as compute from '../marketing/compute-lanes';
import * as home from '../marketing/home';
import * as product from '../marketing/product';
import * as solutions from '../marketing/solutions';
import * as verification from '../marketing/verification';

const FORBIDDEN = [
  /passkey/i,
  /paymaster/i,
  /passive income/i,
  /\bAPY\b/i,
  /prepaid/i,
  /reloadable/i,
  /partner/i,
  /smart account/i,
  /no account/i,
  /no email/i,
];

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe('marketing copy rules', () => {
  const all = strings([home, product, solutions, compute, verification].map((m) => ({ ...m })));
  it('has content', () => expect(all.length).toBeGreaterThan(100));
  it.each(FORBIDDEN.map((r) => [String(r), r] as const))('contains no %s', (_n, re) => {
    expect(all.filter((s) => re.test(s))).toEqual([]);
  });
  it('labels the sealed lane as in testing', () => {
    expect(compute.sealedLane.badge).toBe('In testing');
  });
});
