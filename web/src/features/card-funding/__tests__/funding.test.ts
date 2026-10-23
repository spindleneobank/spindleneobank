import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { erc20Abi, swapRouter02Abi } from '@spindle/shared/abi';
import { describe, expect, it } from 'vitest';
import { formatUnitsTrim, parseAmount, reviveArgs } from '../lib';
import { describeFunding } from '../status';

const op = (status: Parameters<typeof describeFunding>[0]['status'], kind: 'issue' | 'topup' = 'topup') => ({
  id: 'op_1',
  kind,
  status,
  error: null,
});

describe('describeFunding (card-flows status table)', () => {
  it('shows success only for completed', () => {
    const phases = (
      ['created', 'submitting', 'awaiting_payment', 'processing', 'failed', 'expired', 'review'] as const
    ).map((s) => describeFunding(op(s), { status: 'success' }).tone);
    expect(phases).not.toContain('ok');
    expect(describeFunding(op('completed'), { status: 'success' })).toMatchObject({
      text: 'Top-up complete',
      tone: 'ok',
    });
    expect(describeFunding(op('completed', 'issue'), null).text).toBe('Card ready');
  });
  it('maps relay progress while awaiting payment', () => {
    expect(describeFunding(op('awaiting_payment'), null).phase).toBe('pay');
    expect(describeFunding(op('awaiting_payment'), { status: 'quoted' }).phase).toBe('pay');
    expect(describeFunding(op('awaiting_payment'), { status: 'signing' }).phase).toBe('pay');
    expect(describeFunding(op('awaiting_payment'), { status: 'signing', depositTx: '0xabc' }).phase).toBe(
      'bridging',
    );
    for (const s of ['submitted', 'pending'] as const) {
      expect(describeFunding(op('awaiting_payment'), { status: s }).text).toBe('Bridging…');
    }
    expect(describeFunding(op('processing'), { status: 'success' }).text).toBe(
      'Payment received, crediting card…',
    );
  });
  it('handles refund, review, expired and failed', () => {
    expect(describeFunding(op('awaiting_payment'), { status: 'refund' }).text).toBe(
      'Bridge refunded USDG to your wallet',
    );
    expect(describeFunding(op('review'), null).text).toContain('no action needed');
    expect(describeFunding(op('expired'), null).text).toContain('Invoice expired');
    expect(describeFunding({ ...op('failed'), error: 'nope' }, null).text).toContain('Support id: op_1');
  });
});

describe('amount helpers', () => {
  it('parses decimals with bigint math and rejects bad input', () => {
    expect(parseAmount('12.5', 6)).toBe(12_500_000n);
    expect(parseAmount('0.000001', 6)).toBe(1n);
    expect(parseAmount('1.0000001', 6)).toBeNull();
    expect(parseAmount('', 6)).toBeNull();
    expect(parseAmount('abc', 6)).toBeNull();
    expect(parseAmount('25', 2)).toBe(2500n);
  });
  it('formats units', () => {
    expect(formatUnitsTrim(1_234_500_000n, 6)).toBe('1,234.5');
    expect(formatUnitsTrim(10n ** 18n, 18)).toBe('1');
  });
});

describe('reviveArgs', () => {
  it('turns JSON strings into bigint through tuples', () => {
    const [p] = reviveArgs(swapRouter02Abi, 'exactInputSingle', [
      {
        tokenIn: '0x0000000000000000000000000000000000000001',
        tokenOut: '0x0000000000000000000000000000000000000002',
        fee: 500,
        recipient: '0x0000000000000000000000000000000000000003',
        amountIn: '20000000',
        amountOutMinimum: '5',
        sqrtPriceLimitX96: '0',
      },
    ]) as [Record<string, unknown>];
    expect(p?.amountIn).toBe(20_000_000n);
    expect(p?.fee).toBe(500n);
    expect(reviveArgs(erc20Abi, 'approve', ['0x0000000000000000000000000000000000000001', '7'])[1]).toBe(7n);
  });
});

describe('no client-side fee formula', () => {
  it('feature sources never compute izipay fees', () => {
    const files = ['card-funding', 'payments'].flatMap((d) =>
      readdirSync(join(__dirname, '..', '..', d))
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(__dirname, '..', '..', d, f)),
    );
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\*\s*0\.03|1\.7\b|feePct|computeFee/);
    }
  });
});
