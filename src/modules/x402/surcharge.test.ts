import { beforeEach, describe, expect, test } from 'bun:test';
import gas from '../../../contracts/gas/settle-gas.json';
import {
  currentSurchargeMicros,
  gasPerItem,
  refreshSurcharge,
  resetSurchargeMemo,
  SURCHARGE_KV_KEY,
  type SurchargeDeps,
  surchargeFormula,
  X402_GAS_PER_ITEM,
} from './surcharge';
import { memKv } from './testing';

const GWEI = 10n ** 9n;
const deps = (over: Partial<SurchargeDeps> = {}): SurchargeDeps => ({
  kv: memKv(),
  now: () => new Date('2026-10-23T12:00:00Z'),
  ethUsdMicros: async () => 3000n * 1_000_000n,
  gasPriceWei: async () => GWEI / 50n, // 0.02 gwei
  estimateBatchGas: async (n) => 100_000n + BigInt(n) * 40_000n,
  minMicros: 5000n,
  ...over,
});

beforeEach(() => resetSurchargeMemo());

describe('surchargeFormula', () => {
  test('measured gas per item comes from the C3 file', () => {
    expect(X402_GAS_PER_ITEM).toBe(BigInt(gas.perItem));
    expect(X402_GAS_PER_ITEM).toBeGreaterThan(58_000n);
  });

  test('is the minimum when gas is cheap', () => {
    // 2 x 58413 x 0.02 gwei x $3000 = $0.007 -> 7009 micros; with 0.001 gwei it falls below the floor
    expect(
      surchargeFormula({
        gasPerItem: 58_413n,
        gasPriceWei: GWEI / 1000n,
        ethUsdMicros: 3000_000_000n,
        minMicros: 5000n,
      }),
    ).toBe(5000n);
  });

  test('2 x gasPerItem x gasPrice x ethUsd (rounded up) when above the minimum', () => {
    const s = surchargeFormula({
      gasPerItem: 58_413n,
      gasPriceWei: GWEI / 50n,
      ethUsdMicros: 3000_000_000n,
      minMicros: 5000n,
    });
    // 2*58413*2e7 wei = 2.33652e12 wei = 2.33652e-6 ETH x $3000 = $0.00700956 -> 7010 micros
    expect(s).toBe(7010n);
  });

  test('always covers 2x the gas cost it was computed from', () => {
    for (const price of [1n, 20_000_000n, 5n * GWEI]) {
      for (const eth of [500n * 1_000_000n, 4000n * 1_000_000n]) {
        const s = surchargeFormula({
          gasPerItem: X402_GAS_PER_ITEM,
          gasPriceWei: price,
          ethUsdMicros: eth,
          minMicros: 0n,
        });
        const costMicros = (X402_GAS_PER_ITEM * price * eth) / 10n ** 18n;
        expect(s).toBeGreaterThanOrEqual(2n * costMicros);
      }
    }
  });
});

describe('gasPerItem (total gas incl. L1 via estimateGas)', () => {
  test('uses the estimate slope when it exceeds the measured execution gas', async () => {
    const r = await gasPerItem({ estimateBatchGas: async (n) => 100_000n + BigInt(n) * 90_000n });
    expect(r).toEqual({ value: 90_000n, source: 'estimate' });
  });
  test('uses max(measured, estimate): a lower estimate never wins', async () => {
    const r = await gasPerItem({ estimateBatchGas: async (n) => 100_000n + BigInt(n) * 40_000n });
    expect(r).toEqual({ value: X402_GAS_PER_ITEM, source: 'measured' });
  });
  test('falls back to measured when estimateGas fails', async () => {
    const r = await gasPerItem({
      estimateBatchGas: async () => {
        throw new Error('rpc down');
      },
    });
    expect(r.source).toBe('measured');
  });
});

describe('refreshSurcharge / currentSurchargeMicros', () => {
  test('stores kv(x402:surcharge) and serves it', async () => {
    const d = deps({ estimateBatchGas: async (n) => 100_000n + BigInt(n) * 200_000n });
    const rec = await refreshSurcharge(d);
    expect(rec.gasSource).toBe('estimate');
    expect(d.kv.get(SURCHARGE_KV_KEY)).resolves.toEqual(rec);
    // 2 x 200000 x 2e7 wei = 8e12 -> 8e-6 ETH x 3000 = $0.024
    expect(await currentSurchargeMicros(d)).toBe(24_000n);
  });

  test('price read failure keeps the previous value for 15 minutes, then goes unknown', async () => {
    const kv = memKv();
    await refreshSurcharge(deps({ kv }));
    const failing = (now: string) =>
      deps({
        kv,
        now: () => new Date(now),
        ethUsdMicros: async () => {
          throw new Error('pool down');
        },
      });
    const kept = await refreshSurcharge(failing('2026-10-23T12:10:00Z'));
    expect(kept.ethUsdMicros).toBe('3000000000');
    expect(kept.surchargeMicros).not.toBeNull();
    const unknown = await refreshSurcharge(failing('2026-10-23T12:30:00Z'));
    expect(unknown.surchargeMicros).toBeNull();
    resetSurchargeMemo();
    expect(await currentSurchargeMicros(failing('2026-10-23T12:30:30Z'))).toBeNull();
  });

  test('a stale record is recomputed inline', async () => {
    const kv = memKv();
    await refreshSurcharge(deps({ kv }));
    resetSurchargeMemo();
    const later = deps({
      kv,
      now: () => new Date('2026-10-23T13:00:00Z'),
      ethUsdMicros: async () => 6000n * 1_000_000n,
    });
    const v = await currentSurchargeMicros(later);
    expect(v).toBe(14_020n); // doubled ETH price -> doubled surcharge (7010 x 2)
  });
});
