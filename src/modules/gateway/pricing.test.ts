import { describe, expect, test } from 'bun:test';
import { actualCharge, maxCharge, mulDivCeil, unitKindFor } from './pricing';

const rate = (n: bigint) => ({ buyerMicrosPerUnit: n });

describe('pricing', () => {
  test('mulDivCeil rounds up, mulDivFloor-based actual rounds down', () => {
    expect(mulDivCeil(1n, 1n, 3n)).toBe(1n);
    expect(mulDivCeil(3n, 1n, 3n)).toBe(1n);
    expect(mulDivCeil(0n, 5n, 3n)).toBe(0n);
  });

  test('chat: max rounds up, actual rounds down, max >= actual', () => {
    const r = rate(1_250_000n); // 1.25 USDG per 1M tokens
    // (10 + 5) * 1_250_000 / 1_000_000 = 18.75 -> 19 reserved, 18 charged
    expect(maxCharge({ kind: 'chat', promptTokens: 10, maxTokens: 5 }, r)).toBe(19n);
    expect(actualCharge({ kind: 'chat', promptTokens: 10, completionTokens: 5 }, r)).toBe(18n);
    expect(actualCharge({ kind: 'chat', promptTokens: 10, completionTokens: 0 }, r)).toBe(12n);
  });

  test('one token costs at least nothing and at most one micro at low rates', () => {
    const r = rate(100_000n);
    expect(actualCharge({ kind: 'chat', promptTokens: 1, completionTokens: 0 }, r)).toBe(0n);
    expect(maxCharge({ kind: 'chat', promptTokens: 1, maxTokens: 0 }, r)).toBe(1n);
  });

  test('large values stay exact (no float precision loss)', () => {
    const r = rate(123_456_789_012_345n);
    const out = actualCharge({ kind: 'chat', promptTokens: 8192, completionTokens: 8192 }, r);
    expect(out).toBe((16384n * 123_456_789_012_345n) / 1_000_000n);
    expect(typeof out).toBe('bigint');
  });

  test('embeddings and images', () => {
    expect(maxCharge({ kind: 'embeddings', inputTokens: 1000 }, rate(20_000n))).toBe(20n);
    expect(actualCharge({ kind: 'embeddings', promptTokens: 999 }, rate(20_000n))).toBe(19n);
    expect(maxCharge({ kind: 'images', n: 3 }, rate(40_000n))).toBe(120_000n);
    expect(actualCharge({ kind: 'images', images: 2 }, rate(40_000n))).toBe(80_000n);
  });

  test('rejects invalid unit counts', () => {
    expect(() => maxCharge({ kind: 'images', n: -1 }, rate(1n))).toThrow();
    expect(() => maxCharge({ kind: 'images', n: Number.NaN }, rate(1n))).toThrow();
  });

  test('unit kinds', () => {
    expect(unitKindFor('chat')).toBe('tokens_1m');
    expect(unitKindFor('embeddings')).toBe('tokens_1m');
    expect(unitKindFor('images')).toBe('image');
  });
});
