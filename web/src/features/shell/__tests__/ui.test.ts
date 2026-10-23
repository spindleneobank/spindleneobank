import { describe, expect, it } from 'vitest';
import { countdown, shortHash } from '../ui';

describe('countdown', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');
  it('formats minutes and seconds', () => {
    expect(countdown('2026-10-23T10:37:12Z', now)).toBe('37m 12s');
  });
  it('formats hours', () => {
    expect(countdown('2026-10-23T12:05:00Z', now)).toBe('2h 05m');
  });
  it('is null for the past or missing target', () => {
    expect(countdown('2026-10-23T09:00:00Z', now)).toBeNull();
    expect(countdown(null, now)).toBeNull();
  });
});
describe('shortHash', () => {
  it('shortens', () => expect(shortHash(`0x${'a'.repeat(64)}`)).toBe('0xaaaaaa…aaaaaa'));
});
