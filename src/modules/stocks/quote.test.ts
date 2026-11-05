import { describe, expect, test } from 'bun:test';
import { ContractFunctionRevertedError, decodeFunctionData } from 'viem';
import { AppError } from '../../lib/errors';
import { PINNED, swapRouter02Abi } from './abi';
import {
  minOutFor,
  priceImpactBps,
  Q96,
  type QuoteDeps,
  quote,
  quoteSettings,
  type StockRow,
  SWAP_DEADLINE_SEC,
  tickDeviationBps,
  twapTickOf,
} from './quote';

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
    readPool: async () => ({ sqrtPriceX96: SQRT_USDG_TOKEN0, tick: 230000, token0: USDG as `0x${string}` }),
    twapTick: async () => 230000,
    allowance: async () => 0n,
    now: () => Date.UTC(2026, 0, 1),
    ...over,
  };
}
const req = { token: NVDA, amountInMicros: '1000000000', user: USER };

describe('TWAP bound (M-3, L-7)', () => {
  test('average tick rounds towards negative infinity, like the Uniswap oracle library', () => {
    expect(twapTickOf([0n, 1800n * 100n])).toBe(100);
    expect(twapTickOf([0n, 1800n * 100n + 1n])).toBe(100);
    expect(twapTickOf([0n, -1800n * 100n])).toBe(-100);
    expect(twapTickOf([0n, -1800n * 100n - 1n])).toBe(-101);
    expect(twapTickOf([-5000n, -5000n + 1800n * 7n])).toBe(7);
  });
  test('deviation is measured in bps of price, in either direction', () => {
    expect(tickDeviationBps(100, 100)).toBe(0);
    expect(tickDeviationBps(100, 0)).toBe(tickDeviationBps(0, 100));
    expect(tickDeviationBps(488, 0)).toBeGreaterThanOrEqual(499);
    expect(tickDeviationBps(488, 0)).toBeLessThanOrEqual(501);
  });
  test('a spot price far from the 30-minute average gets no quote', async () => {
    const limit = quoteSettings.maxTwapDeviationBps;
    expect(limit).toBe(500);
    const err = await quote(deps({ twapTick: async () => 230_000 - 600 }), req).catch((e) => e);
    expect(err.code).toBe('INSUFFICIENT_LIQUIDITY');
    expect(err.message).toContain('30-minute average');
    const up = await quote(deps({ twapTick: async () => 230_000 + 600 }), req).catch((e) => e);
    expect(up.code).toBe('INSUFFICIENT_LIQUIDITY');
  });
  test('a spot price within the bound is quoted', async () => {
    const q = await quote(deps({ twapTick: async () => 230_000 - 400 }), req);
    expect(BigInt(q.amountOut)).toBeGreaterThan(0n);
  });
});

describe('quote', () => {
  test('swap recipient is the session user; approve is to the router; expires in 60s', async () => {
    const q = await quote(deps(), req);
    expect(q.swap.to).toBe(PINNED.ROUTER);
    expect(q.swap.functionName).toBe('multicall');
    expect(q.swap.value).toBe('0');
    const [deadline, calls] = q.swap.args as [string, `0x${string}`[]];
    expect(Number(deadline)).toBe(Math.floor(deps().now() / 1000) + SWAP_DEADLINE_SEC); // L-7
    const inner = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0] as `0x${string}` });
    expect(inner.functionName).toBe('exactInputSingle');
    const p = inner.args?.[0] as {
      recipient: string;
      tokenIn: string;
      tokenOut: string;
      amountOutMinimum: bigint;
    };
    expect(p.recipient.toLowerCase()).toBe(USER.toLowerCase());
    expect(p.tokenIn.toLowerCase()).toBe(USDG.toLowerCase());
    expect(p.tokenOut.toLowerCase()).toBe(NVDA.toLowerCase());
    expect(p.amountOutMinimum.toString()).toBe(q.minOut);
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
    const [, calls] = q.swap.args as [string, `0x${string}`[]];
    const inner = decodeFunctionData({ abi: swapRouter02Abi, data: calls[0] as `0x${string}` });
    expect(((inner.args as readonly unknown[])[0] as { tokenOut: string }).tokenOut.toLowerCase()).toBe(
      NVDA.toLowerCase(),
    );
    const err = await quote(deps(), { ...req, token: USDG }).catch((e) => e);
    expect(err.status).toBe(400);
  });

  test('bad amount / slippage rejected', async () => {
    expect((await quote(deps(), { ...req, amountInMicros: '0' }).catch((e) => e)).status).toBe(400);
    expect((await quote(deps(), { ...req, slippageBps: 5000 }).catch((e) => e)).status).toBe(400);
  });

  test('quoter revert maps to 409 INSUFFICIENT_LIQUIDITY', async () => {
    const revert = async () => {
      throw new Error('execution reverted');
    };
    const err = await quote(deps({ quoteExactIn: revert }), req).catch((e) => e);
    expect(err.code).toBe('INSUFFICIENT_LIQUIDITY');
    expect(err.status).toBe(409);
    const viemRevert = await quote(
      deps({
        quoteExactIn: async () => {
          throw new ContractFunctionRevertedError({ abi: [], functionName: 'quoteExactInputSingle' });
        },
      }),
      req,
    ).catch((e) => e);
    expect(viemRevert.code).toBe('INSUFFICIENT_LIQUIDITY');
  });

  test('rpc/transport failures map to 502 UPSTREAM_UNAVAILABLE (quoter, pool, allowance)', async () => {
    const boom = (m: string) => async () => {
      throw new Error(m);
    };
    for (const over of [
      { quoteExactIn: boom('historical state not available') },
      { quoteExactIn: boom('request timed out') },
      { readPool: boom('fetch failed') },
      { twapTick: boom('OLD') },
      { allowance: boom('The network is not responding') },
    ]) {
      const err = await quote(deps(over), req).catch((e) => e);
      expect(err.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(err.status).toBe(502);
    }
  });
});
