import { describe, expect, test } from 'bun:test';
import { AppError } from '../../lib/errors';
import { PINNED } from './abi';
import { minOutFor, priceImpactBps, Q96, type QuoteDeps, quote, type StockRow } from './quote';

const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec';
const POOL = '0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3';
const USER = '0x00000000000000000000000000000000000000aa';

// 1 USDG (1e6 raw, 6 dec) = 0.01 NVDA (1e16 raw, 18 dec): raw token1/token0 price = 1e10.
const SQRT_USDG_TOKEN0 = 100_000n * Q96; // sqrt(1e10) = 1e5
const SQRT_USDG_TOKEN1 = Q96 / 100_000n; // sqrt(1e-10) = 1e-5

describe('priceImpactBps', () => {
  const amountIn = 1_000n * 10n ** 6n;
  const midOut = amountIn * 10n ** 10n; // fee-free expected output

  test('USDG is token0', () => {
    const out = (midOut * 99n) / 100n;
    expect(
      priceImpactBps({
        amountIn,
        amountOut: out,
        sqrtPriceX96: SQRT_USDG_TOKEN0,
        usdgIsToken0: true,
        fee: 0,
      }),
    ).toBe(100);
  });

  test('USDG is token1 (inverted price)', () => {
    const out = (midOut * 99n) / 100n;
    const bps = priceImpactBps({
      amountIn,
      amountOut: out,
      sqrtPriceX96: SQRT_USDG_TOKEN1,
      usdgIsToken0: false,
      fee: 0,
    });
    expect(bps).toBeGreaterThanOrEqual(99);
    expect(bps).toBeLessThanOrEqual(100);
  });

  test('both orderings agree for the same economic price', () => {
    const out = (midOut * 97n) / 100n;
    const a = priceImpactBps({
      amountIn,
      amountOut: out,
      sqrtPriceX96: SQRT_USDG_TOKEN0,
      usdgIsToken0: true,
      fee: 500,
    });
    const b = priceImpactBps({
      amountIn,
      amountOut: out,
      sqrtPriceX96: SQRT_USDG_TOKEN1,
      usdgIsToken0: false,
      fee: 500,
    });
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  test('pool fee is excluded from impact; output at mid minus fee is ~0 impact', () => {
    const out = (midOut * 9995n) / 10000n; // exactly the 0.05% fee
    expect(
      priceImpactBps({
        amountIn,
        amountOut: out,
        sqrtPriceX96: SQRT_USDG_TOKEN0,
        usdgIsToken0: true,
        fee: 500,
      }),
    ).toBe(0);
  });

  test('better-than-mid output clamps to 0', () => {
    expect(
      priceImpactBps({
        amountIn,
        amountOut: midOut * 2n,
        sqrtPriceX96: SQRT_USDG_TOKEN0,
        usdgIsToken0: true,
        fee: 0,
      }),
    ).toBe(0);
  });
});

test('minOut applies slippage', () => {
  expect(minOutFor(10_000n, 50)).toBe(9_950n);
  expect(minOutFor(10_000n, 1000)).toBe(9_000n);
});

const row = (over: Partial<StockRow> = {}): StockRow => ({
  address: NVDA,
  symbol: 'NVDA',
  name: 'NVIDIA',
  decimals: 18,
  poolFee: 500,
  poolAddress: POOL,
  enabled: true,
  ...over,
});

function deps(over: Partial<QuoteDeps> = {}, stock: StockRow | null = row()): QuoteDeps {
  return {
    getStock: async (a) => (stock && a === stock.address ? stock : undefined),
    quoteExactIn: async ({ amountIn }) => (amountIn * 10n ** 10n * 99n) / 100n,
    readPool: async () => ({ sqrtPriceX96: SQRT_USDG_TOKEN0, token0: USDG as `0x${string}` }),
    allowance: async () => 0n,
    now: () => Date.UTC(2026, 0, 1),
    ...over,
  };
}
const req = { token: NVDA, amountInMicros: '1000000000', user: USER };

describe('quote', () => {
  test('swap recipient is the session user; approve is to the router; expires in 60s', async () => {
    const q = await quote(deps(), req);
    expect(q.swap.to).toBe(PINNED.ROUTER);
    expect(q.swap.functionName).toBe('exactInputSingle');
    expect(q.swap.value).toBe('0');
    const p = q.swap.args[0];
    expect(p.recipient).toBe(USER);
    expect(p.tokenIn).toBe(USDG);
    expect(p.tokenOut).toBe(NVDA);
    expect(p.amountOutMinimum).toBe(q.minOut);
    expect(q.approve?.to).toBe(USDG);
    expect(q.approve?.args).toEqual([PINNED.ROUTER, '1000000000']);
    expect(Date.parse(q.expiresAt) - Date.parse(q.quotedAt)).toBe(60_000);
    expect(q.priceImpactBps).toBe(95); // 100 bps shortfall minus the 5 bps pool fee
    expect(q.warnImpact).toBe(false);
  });

  test('no approve when allowance suffices; warn above 2% impact', async () => {
    const q = await quote(
      deps({
        allowance: async () => 10n ** 12n,
        quoteExactIn: async ({ amountIn }) => (amountIn * 10n ** 10n * 97n) / 100n,
      }),
      req,
    );
    expect(q.approve).toBeUndefined();
    expect(q.priceImpactBps).toBe(295);
    expect(q.warnImpact).toBe(true);
  });

  test('unknown token rejected with 400', async () => {
    const err = await quote(deps({}, null), req).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
  });

  test('disabled token rejected with 400', async () => {
    const err = await quote(deps({}, row({ enabled: false })), req).catch((e) => e);
    expect(err.status).toBe(400);
  });

  test('token address is case-insensitive but only curated addresses resolve', async () => {
    const q = await quote(deps(), { ...req, token: NVDA.toUpperCase().replace('0X', '0x') });
    expect(q.swap.args[0].tokenOut).toBe(NVDA);
    const err = await quote(deps(), { ...req, token: USDG }).catch((e) => e);
    expect(err.status).toBe(400);
  });

  test('bad amount / slippage rejected', async () => {
    expect((await quote(deps(), { ...req, amountInMicros: '0' }).catch((e) => e)).status).toBe(400);
    expect((await quote(deps(), { ...req, slippageBps: 5000 }).catch((e) => e)).status).toBe(400);
  });

  test('quoter revert maps to INSUFFICIENT_LIQUIDITY', async () => {
    const err = await quote(
      deps({
        quoteExactIn: async () => {
          throw new Error('revert');
        },
      }),
      req,
    ).catch((e) => e);
    expect(err.code).toBe('INSUFFICIENT_LIQUIDITY');
  });
});
