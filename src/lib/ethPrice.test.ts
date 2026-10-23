import { describe, expect, test } from 'bun:test';
import { uniswapV3PoolAbi } from '@spindle/shared/abi';
import { KNOWN } from '@spindle/shared/chain';
import { createPublicClient, http } from 'viem';
import { ethUsdMicrosFromSqrtPrice, readEthUsdMicros } from './ethPrice';

const ANVIL = process.env.ANVIL_URL ?? 'http://127.0.0.1:7245';
const Q96 = 1n << 96n;
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
const sqrtFor = (usdgRaw: bigint, wethRaw: bigint, usdgIsToken0: boolean) =>
  usdgIsToken0 ? isqrt((wethRaw << 192n) / usdgRaw) : isqrt((usdgRaw << 192n) / wethRaw);

describe('ethPrice math', () => {
  const target = 2500n * 10n ** 6n;
  for (const usdgIsToken0 of [false, true]) {
    test(`orientation usdgIsToken0=${usdgIsToken0}`, () => {
      const sqrtPriceX96 = sqrtFor(target, 10n ** 18n, usdgIsToken0);
      const got = ethUsdMicrosFromSqrtPrice({ sqrtPriceX96, usdgIsToken0 });
      const diff = got > target ? got - target : target - got;
      expect(diff).toBeLessThanOrEqual(1n);
    });
  }
  test('bounds reject absurd prices', () => {
    expect(() =>
      ethUsdMicrosFromSqrtPrice({
        sqrtPriceX96: sqrtFor(50n * 10n ** 6n, 10n ** 18n, false),
        usdgIsToken0: false,
      }),
    ).toThrow();
    expect(() =>
      ethUsdMicrosFromSqrtPrice({
        sqrtPriceX96: sqrtFor(500_000n * 10n ** 6n, 10n ** 18n, false),
        usdgIsToken0: false,
      }),
    ).toThrow();
    expect(() => ethUsdMicrosFromSqrtPrice({ sqrtPriceX96: 0n, usdgIsToken0: false })).toThrow();
    expect(Q96).toBeGreaterThan(0n);
  });
});

const anvilUp = await fetch(ANVIL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
})
  .then((r) => r.ok)
  .catch(() => false);
if (!anvilUp) console.warn(`SKIP: anvil unreachable at ${ANVIL}; fork price tests skipped`);

describe.skipIf(!anvilUp)('ethPrice on anvil fork', () => {
  const client = createPublicClient({ transport: http(ANVIL) });
  for (const pool of [KNOWN.USDG_WETH_POOL_500, KNOWN.USDG_WETH_POOL_3000]) {
    test(`pool ${pool} within bounds`, async () => {
      const t0 = await client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'token0' });
      const micros = await readEthUsdMicros(client, pool);
      console.log(`fork ETH/USD ${pool} token0=${t0}: ${Number(micros) / 1e6}`);
      expect(micros).toBeGreaterThanOrEqual(100_000_000n);
      expect(micros).toBeLessThanOrEqual(100_000_000_000n);
    });
  }
});
