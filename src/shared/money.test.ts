import { describe, expect, test } from 'bun:test';
import { centsToMicros, fromMicros, MicrosString, microsToCents, mulDivFloor, toMicros } from './money';

describe('money', () => {
  test('round trips', () => {
    for (const s of ['0', '1', '12.5', '0.000001', '1000000', '123456789.123456']) {
      expect(fromMicros(toMicros(s))).toBe(s);
    }
    expect(toMicros('12.5')).toBe(12_500_000n);
    expect(fromMicros(12_500_000n)).toBe('12.5');
    expect(fromMicros(-1_500_000n)).toBe('-1.5');
  });
  test('rejects bad input', () => {
    for (const s of ['1.0000001', '-1', '1e6', '', '.5', '1.', ' 1']) expect(() => toMicros(s)).toThrow();
  });
  test('cents', () => {
    expect(centsToMicros(150n)).toBe(1_500_000n);
    expect(microsToCents(1_509_999n)).toBe(150n);
  });
  test('MicrosString', () => {
    expect(MicrosString.safeParse('123').success).toBe(true);
    expect(MicrosString.safeParse('-1').success).toBe(false);
    expect(MicrosString.safeParse('1'.repeat(79)).success).toBe(false);
    expect(mulDivFloor(7n, 3n, 2n)).toBe(10n);
  });
});
