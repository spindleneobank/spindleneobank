/** Properties of the money arithmetic: what is reserved always covers what is charged, and rounding never favours anyone it should not. */
import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { maxOutputBytes } from '../../lib/limits';
import { bpsOf, mulDivDown } from '../../lib/money';
import { buyerFromProvider } from '../rates/defaults';
import { tickDeviationBps, twapTickOf } from '../stocks/quote';
import { creditLimit, x402Limits } from '../x402/verify';
import { actualCharge, maxCharge, mulDivCeil } from './pricing';

const tokens = fc.integer({ min: 0, max: 2_000_000 });
const rate = fc.bigInt({ min: 1n, max: 50_000_000n }).map((buyerMicrosPerUnit) => ({ buyerMicrosPerUnit }));
const amount = fc.bigInt({ min: 0n, max: 10n ** 15n });

describe('reservation and charge', () => {
  test('a reservation covers any charge the job can produce', () => {
    fc.assert(
      fc.property(tokens, tokens, fc.nat(1_000_000), fc.nat(1_000_000), rate, (p, m, up, uc, r) => {
        const reserved = maxCharge({ kind: 'chat', promptTokens: p, maxTokens: m }, r);
        const charged = actualCharge(
          { kind: 'chat', promptTokens: Math.min(up, p), completionTokens: Math.min(uc, m) },
          r,
        );
        expect(charged).toBeLessThanOrEqual(reserved);
      }),
    );
  });
  test('charging more tokens never costs less', () => {
    fc.assert(
      fc.property(tokens, tokens, rate, (a, b, r) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(actualCharge({ kind: 'embeddings', promptTokens: lo }, r)).toBeLessThanOrEqual(
          actualCharge({ kind: 'embeddings', promptTokens: hi }, r),
        );
      }),
    );
  });
  test('negative or impossible units are refused', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1000, max: -1 }),
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
        ),
        rate,
        (bad, r) => {
          expect(() => actualCharge({ kind: 'embeddings', promptTokens: bad }, r)).toThrow();
        },
      ),
    );
  });
});

describe('rounding', () => {
  test('ceil is the smallest whole amount at or above floor, and they differ by at most one', () => {
    fc.assert(
      fc.property(amount, amount, fc.bigInt({ min: 1n, max: 10n ** 9n }), (a, b, c) => {
        const down = mulDivDown(a, b, c);
        const up = mulDivCeil(a, b, c);
        expect(up - down === 0n || up - down === 1n).toBe(true);
        expect(down * c).toBeLessThanOrEqual(a * b);
        expect(up * c).toBeGreaterThanOrEqual(a * b);
      }),
    );
  });
  test('a provider share is never more than its basis points', () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 0, max: 10_000 }), (a, bps) => {
        expect(bpsOf(a, bps) * 10_000n).toBeLessThanOrEqual(a * BigInt(bps));
        expect(bpsOf(a, bps)).toBeLessThanOrEqual(a);
      }),
    );
  });
  test('a default rate always leaves the provider at most 80% of the buyer price', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), (provider) => {
        expect(provider * 10_000n).toBeLessThanOrEqual(buyerFromProvider(provider) * 8_000n);
      }),
    );
  });
});

describe('x402 credit', () => {
  test('stays within the payer cap and never falls as a wallet settles more', () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(creditLimit(lo)).toBeLessThanOrEqual(creditLimit(hi));
        expect(creditLimit(hi)).toBeLessThanOrEqual(20_000_000n);
      }),
    );
  });
  test('credit from history stays below what history costs an operator serving themselves', () => {
    const saved = { ...x402Limits };
    Object.assign(x402Limits, { newPayerCredit: 50_000n, creditPerSettledBps: 1000n });
    try {
      fc.assert(
        fc.property(amount, (paid) => {
          expect((creditLimit(paid) - 50_000n) * 10_000n).toBeLessThanOrEqual(paid * 2_000n);
        }),
      );
    } finally {
      Object.assign(x402Limits, saved);
    }
  });
});

describe('limits and price checks', () => {
  test('node output limit is at least 4 KiB and grows with max_tokens', () => {
    fc.assert(
      fc.property(fc.nat(1_000_000), fc.nat(1_000_000), fc.boolean(), (a, b, sealed) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(maxOutputBytes(lo, sealed)).toBeGreaterThanOrEqual(4096);
        expect(maxOutputBytes(lo, sealed)).toBeLessThanOrEqual(maxOutputBytes(hi, sealed));
      }),
    );
  });
  test('TWAP tick rounds toward negative infinity, like the Uniswap oracle', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        fc.integer({ min: 1, max: 86_400 }),
        (delta, w) => {
          const tick = BigInt(twapTickOf([0n, delta], w));
          expect(tick * BigInt(w)).toBeLessThanOrEqual(delta);
          expect((tick + 1n) * BigInt(w)).toBeGreaterThan(delta);
        },
      ),
    );
  });
  test('deviation is symmetric, and zero only at the same tick', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -887_272, max: 887_272 }),
        fc.integer({ min: -2000, max: 2000 }),
        (t, d) => {
          expect(tickDeviationBps(t, t + d)).toBe(tickDeviationBps(t + d, t));
          expect(tickDeviationBps(t, t + d) === 0).toBe(d === 0);
        },
      ),
    );
  });
});
