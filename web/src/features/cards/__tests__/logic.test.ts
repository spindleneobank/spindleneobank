import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/errors';
import { describeOp, friendlyError, parseDollars, validateTopup } from '../logic';

const NOW = Date.parse('2026-10-23T10:00:00Z');
const inv = (min: number) => ({
  payAddress: '0xabc',
  payAmount: '20',
  payCurrency: 'usdtbsc',
  network: 'bsc' as const,
  expiresAt: new Date(NOW + min * 60_000).toISOString(),
});
const op = (status: string, kind: 'issue' | 'topup' = 'issue', invoice = inv(10)) =>
  ({ id: 'op1', kind, status, amountUsdCents: '2000', invoice, error: null }) as never;
const relay = (status: string) =>
  ({ id: 'r', requestId: 'q', status, originAmountMicros: '1', depositTx: null, expiresAt: null }) as never;

describe('describeOp', () => {
  it('never reports completion from relay success alone', () => {
    for (const s of ['awaiting_payment', 'processing'] as const) {
      expect(describeOp(op(s), relay('success'), 'pending_payment', NOW).phase).not.toBe('completed');
    }
  });
  it('issue completes only when the card is issued', () => {
    expect(describeOp(op('completed'), relay('success'), 'paid_pending_issue', NOW).phase).toBe('confirming');
    expect(describeOp(op('completed'), relay('success'), 'issued', NOW)).toMatchObject({
      phase: 'completed',
      title: 'Card ready',
    });
  });
  it('an issue with an unknown card still follows the backend completed', () => {
    expect(describeOp(op('completed'), relay('success'), undefined, NOW).phase).toBe('completed');
  });
  it('top-up completes on backend completed', () => {
    expect(describeOp(op('completed', 'topup'), relay('success'), 'issued', NOW).title).toBe(
      'Top-up complete',
    );
  });
  it('maps pay / bridging / refund / review / failed / expired', () => {
    expect(describeOp(op('awaiting_payment'), null, undefined, NOW)).toMatchObject({
      phase: 'pay',
      canPay: true,
    });
    expect(describeOp(op('awaiting_payment'), relay('quoted'), undefined, NOW).canPay).toBe(true);
    expect(describeOp(op('awaiting_payment'), relay('pending'), undefined, NOW)).toMatchObject({
      phase: 'bridging',
      canPay: false,
    });
    expect(describeOp(op('awaiting_payment'), relay('refund'), undefined, NOW).phase).toBe('refunded');
    expect(describeOp(op('review'), null, undefined, NOW).phase).toBe('review');
    expect(describeOp(op('failed'), null, undefined, NOW).phase).toBe('failed');
    expect(describeOp(op('expired'), null, undefined, NOW).phase).toBe('expired');
    expect(describeOp(op('awaiting_payment', 'issue', inv(-1)), null, undefined, NOW).phase).toBe('expired');
    expect(describeOp(op('created'), null, undefined, NOW).title).toBe('Preparing invoice…');
  });
});

describe('top-up amounts', () => {
  it('parses dollars to cents exactly', () => {
    expect(parseDollars('12.5')).toBe(1250n);
    expect(parseDollars('100')).toBe(10000n);
    expect(parseDollars('1.234')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
  });
  it('enforces min, max and the $10,000 UI ceiling', () => {
    expect(validateTopup('5', '1000', '5000000')).toMatch(/minimum/);
    expect(validateTopup('10001', '1000', '5000000')).toMatch(/maximum/);
    expect(validateTopup('10000', '1000', '5000000')).toBeNull();
    expect(validateTopup('600', '1000', '50000')).toMatch(/maximum/);
  });
});

describe('friendlyError', () => {
  it('words the special codes', () => {
    expect(friendlyError(new ApiError('LIVE_WRITES_DISABLED', 'x', 409))).toMatch(/switched off/);
    expect(friendlyError(new ApiError('RATE_LIMITED', 'x', 429))).toMatch(/daily limit/);
    expect(friendlyError(new ApiError('CONFLICT', 'x', 409))).toMatch(/open invoice/);
    expect(friendlyError(new ApiError('INSUFFICIENT_LIQUIDITY', 'x', 409))).toMatch(
      /temporarily unavailable/,
    );
  });
});
