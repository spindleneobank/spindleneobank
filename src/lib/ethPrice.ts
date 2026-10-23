import { uniswapV3PoolAbi } from '@spindle/shared/abi';
import { KNOWN } from '@spindle/shared/chain';
import type { Address } from 'viem';
import { AppError } from './errors';
import { getRedis } from './redis';
import { publicClient } from './viem';

const CACHE_KEY = 'price:eth-usd-micros';
const CACHE_TTL_S = 60;
const MIN_MICROS = 100n * 1_000_000n;
const MAX_MICROS = 100_000n * 1_000_000n;
const Q192 = 1n << 192n;

/**
 * USDG micros per 1 ETH from a v3 sqrtPriceX96. Pure bigint math.
 * price(token1 per token0, raw units) = sqrtP^2 / 2^192.
 */
export function ethUsdMicrosFromSqrtPrice(args: {
  sqrtPriceX96: bigint;
  usdgIsToken0: boolean;
  usdgDecimals?: number;
  wethDecimals?: number;
}): bigint {
  const { sqrtPriceX96, usdgIsToken0 } = args;
  const usdgDec = BigInt(args.usdgDecimals ?? 6);
  const wethDec = BigInt(args.wethDecimals ?? 18);
  if (sqrtPriceX96 <= 0n) throw new AppError('CHAIN_STATE', 'pool has zero price', 500);
  const sq = sqrtPriceX96 * sqrtPriceX96;
  // raw USDG units per 1e18 raw WETH units, then rescaled to micros (6 decimals).
  const oneWeth = 10n ** wethDec;
  const usdgRaw = usdgIsToken0
    ? (oneWeth * Q192) / sq // weth is token1: token0 per token1 = 2^192 / sq
    : (oneWeth * sq) / Q192; // weth is token0: token1 per token0 = sq / 2^192
  const micros = usdgDec === 6n ? usdgRaw : (usdgRaw * 10n ** 6n) / 10n ** usdgDec;
  if (micros < MIN_MICROS || micros > MAX_MICROS) {
    throw new AppError('CHAIN_STATE', `ETH price out of bounds: ${micros} micros`, 500);
  }
  return micros;
}

async function readPool(pool: Address): Promise<bigint> {
  const read = (functionName: 'token0' | 'token1') =>
    publicClient.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName });
  const [slot0, token0] = await Promise.all([
    publicClient.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'slot0' }),
    read('token0'),
  ]);
  return ethUsdMicrosFromSqrtPrice({
    sqrtPriceX96: slot0[0],
    usdgIsToken0: token0.toLowerCase() === KNOWN.USDG.toLowerCase(),
  });
}

/** USDG micros per 1 ETH (Redis-cached 60s). Primary 0.05% pool, fallback 0.3% pool. */
export async function getEthUsdMicros(): Promise<bigint> {
  const redis = getRedis();
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached && /^\d+$/.test(cached)) return BigInt(cached);
  } catch {
    // cache is best-effort
  }
  let value: bigint;
  try {
    value = await readPool(KNOWN.USDG_WETH_POOL_500);
  } catch {
    value = await readPool(KNOWN.USDG_WETH_POOL_3000);
  }
  try {
    await redis.set(CACHE_KEY, value.toString(), 'EX', CACHE_TTL_S);
  } catch {
    // ignore
  }
  return value;
}
