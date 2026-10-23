import { expect, test } from 'bun:test';
import { bpsOf, formatMicros, mulDivDown, parseMicros } from './money';

test('parseMicros', () => {
  expect(parseMicros('12500000')).toBe(12_500_000n);
  expect(() => parseMicros('-1')).toThrow();
  expect(() => parseMicros('1.5')).toThrow();
  expect(parseMicros('-5', { signed: true })).toBe(-5n);
  expect(formatMicros(10n)).toBe('10');
});

test('mulDivDown and bpsOf', () => {
  expect(mulDivDown(10n, 3n, 4n)).toBe(7n);
  expect(bpsOf(1_000_000n, 8000)).toBe(800_000n);
});
