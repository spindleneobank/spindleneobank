import type { Address } from 'viem';
import { AppError } from '../../lib/errors';
import { publicClient } from '../../lib/viem';
import { erc20Abi, quoterV2Abi, stockAddresses, uniswapV3PoolAbi } from './abi';

export const Q96 = 2n ** 96n;
export const WARN_IMPACT_BPS = 200;
export const QUOTE_TTL_MS = 60_000;

/**
 * Price impact in bps of `amountOut` against the pool mid price (from slot0.sqrtPriceX96),
 * with the LP fee excluded from the comparison (so it measures slippage from trade size only).
 * `usdgIsToken0` is the pool's token ordering. Returns >= 0 (rounding artefacts clamp to 0).
 */
export function priceImpactBps(args: {
  amountIn: bigint;
  amountOut: bigint;
  sqrtPriceX96: bigint;
  usdgIsToken0: boolean;
  fee: number;
}): number {
  const { amountIn, amountOut, sqrtPriceX96, usdgIsToken0, fee } = args;
  if (sqrtPriceX96 <= 0n || amountIn <= 0n) return 0;
  const inAfterFee = (amountIn * BigInt(1_000_000 - fee)) / 1_000_000n;
  const sq = sqrtPriceX96 * sqrtPriceX96;
  // price(token1 raw per token0 raw) = sq / 2^192
  const expected = usdgIsToken0 ? (inAfterFee * sq) >> 192n : (inAfterFee << 192n) / sq;
  if (expected <= 0n) return 0;
  const diff = expected - amountOut;
  if (diff <= 0n) return 0;
  return Number((diff * 10_000n) / expected);
}

export const minOutFor = (amountOut: bigint, slippageBps: number) =>
  (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;

export type StockRow = {
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  poolFee: number | null;
  poolAddress: string | null;
  enabled: boolean;
};

export type QuoteDeps = {
  /** Resolve a curated row by lowercase address; undefined when absent. */
  getStock: (address: string) => Promise<StockRow | undefined>;
  quoteExactIn: (p: { tokenOut: Address; amountIn: bigint; fee: number }) => Promise<bigint>;
  readPool: (pool: Address) => Promise<{ sqrtPriceX96: bigint; token0: Address }>;
  allowance: (owner: Address, spender: Address) => Promise<bigint>;
  now: () => number;
};

export const chainQuoteDeps = (getStock: QuoteDeps['getStock']): QuoteDeps => ({
  getStock,
  now: () => Date.now(),
  async quoteExactIn({ tokenOut, amountIn, fee }) {
    const a = stockAddresses();
    const { result } = await publicClient.simulateContract({
      address: a.quoter,
      abi: quoterV2Abi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: a.usdg, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    return result[0];
  },
  async readPool(pool) {
    const [slot0, token0] = await Promise.all([
      publicClient.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'slot0' }),
      publicClient.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'token0' }),
    ]);
    return { sqrtPriceX96: slot0[0], token0: token0.toLowerCase() as Address };
  },
  allowance: (owner, spender) =>
    publicClient.readContract({
      address: stockAddresses().usdg,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, spender],
    }),
});

/**
 * Quote USDG -> stock. Only curated, enabled tokens; recipient is always `user`.
 * `amountInMicros` is USDG micros (6 decimals).
 */
export async function quote(
  deps: QuoteDeps,
  input: { token: string; amountInMicros: string; slippageBps?: number; user: string },
) {
  const slippageBps = input.slippageBps ?? 50;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 1000) {
    throw new AppError('VALIDATION', 'slippageBps must be 1..1000');
  }
  if (!/^\d+$/.test(input.amountInMicros) || BigInt(input.amountInMicros) <= 0n) {
    throw new AppError('VALIDATION', 'amountInMicros must be a positive integer');
  }
  const amountIn = BigInt(input.amountInMicros);
  const row = await deps.getStock(input.token.toLowerCase());
  if (!row?.enabled || row.poolFee == null || !row.poolAddress) {
    throw new AppError('VALIDATION', 'unknown or disabled stock token');
  }
  const a = stockAddresses();
  const tokenOut = row.address as Address;
  const pool = row.poolAddress as Address;
  const user = input.user.toLowerCase() as Address;

  let amountOut: bigint;
  let poolState: Awaited<ReturnType<QuoteDeps['readPool']>>;
  let allowance: bigint;
  try {
    [amountOut, poolState, allowance] = await Promise.all([
      deps.quoteExactIn({ tokenOut, amountIn, fee: row.poolFee }),
      deps.readPool(pool),
      deps.allowance(user, a.router),
    ]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Quoter reverts when the pool cannot fill the size.
    throw new AppError(
      'INSUFFICIENT_LIQUIDITY',
      'quote unavailable: not enough pool liquidity for this amount',
    );
  }
  if (amountOut <= 0n) throw new AppError('INSUFFICIENT_LIQUIDITY', 'quote returned zero output');

  const impact = priceImpactBps({
    amountIn,
    amountOut,
    sqrtPriceX96: poolState.sqrtPriceX96,
    usdgIsToken0: poolState.token0 === a.usdg,
    fee: row.poolFee,
  });
  const minOut = minOutFor(amountOut, slippageBps);
  const quotedMs = deps.now();

  return {
    amountOut: amountOut.toString(),
    priceImpactBps: impact,
    minOut: minOut.toString(),
    warnImpact: impact > WARN_IMPACT_BPS,
    /** Pool LP fee in bps (fee tier / 100); excluded from priceImpactBps. */
    feeBps: row.poolFee / 100,
    ...(allowance < amountIn
      ? {
          approve: {
            to: a.usdg,
            functionName: 'approve',
            args: [a.router, amountIn.toString()],
          },
        }
      : {}),
    swap: {
      to: a.router,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: a.usdg,
          tokenOut,
          fee: row.poolFee,
          recipient: user,
          amountIn: amountIn.toString(),
          amountOutMinimum: minOut.toString(),
          sqrtPriceLimitX96: '0',
        },
      ],
      value: '0' as const,
    },
    quotedAt: new Date(quotedMs).toISOString(),
    expiresAt: new Date(quotedMs + QUOTE_TTL_MS).toISOString(),
  };
}
