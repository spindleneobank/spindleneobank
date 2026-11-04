import type { Address } from 'viem';
import { publicClient } from '../../lib/viem';
import { erc20Abi, FEE_TIERS, factoryAbi, stockAddresses, uniswapV3PoolAbi } from './abi';

const ZERO = '0x0000000000000000000000000000000000000000';

export const minPoolUsdgMicros = () => BigInt(process.env.STOCK_MIN_POOL_USDG ?? '50000') * 1_000_000n;

export type PoolInfo = { fee: number; pool: Address; usdgMicros: bigint; liquidity: bigint };

/** Test seam for the chain reads. */
export const stockChain: { client: Pick<typeof publicClient, 'getCode' | 'readContract'> } = {
  client: publicClient,
};

/**
 * Every USDG/token pool across fee tiers, deepest first by in-range `liquidity()`. Raw USDG balance is not a
 * measure of depth: out-of-range USDG can be parked in a pool and taken out again.
 */
export async function poolsFor(token: Address): Promise<PoolInfo[]> {
  const a = stockAddresses();
  const found: (PoolInfo | undefined)[] = await Promise.all(
    FEE_TIERS.map(async (fee): Promise<PoolInfo | undefined> => {
      const pool = await stockChain.client.readContract({
        address: a.factory,
        abi: factoryAbi,
        functionName: 'getPool',
        args: [a.usdg, token, fee],
      });
      if (pool === ZERO) return undefined;
      const [usdgMicros, liquidity] = await Promise.all([
        stockChain.client.readContract({
          address: a.usdg,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [pool],
        }),
        stockChain.client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'liquidity' }),
      ]);
      return { fee, pool: pool.toLowerCase() as Address, usdgMicros, liquidity };
    }),
  );
  return found
    .filter((p): p is PoolInfo => p !== undefined)
    .sort((x, y) => (x.liquidity < y.liquidity ? 1 : x.liquidity > y.liquidity ? -1 : 0));
}

export async function readTokenMeta(token: Address) {
  const [symbol, name, decimals] = await Promise.all([
    stockChain.client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    stockChain.client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    stockChain.client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
  ]);
  return { symbol, name, decimals: Number(decimals) };
}

export type VerifyResult =
  | {
      ok: true;
      address: string;
      symbol: string;
      name: string;
      decimals: number;
      poolFee: number;
      poolAddress: string;
      usdgLiquidityMicros: string;
      /** The deepest pool, when it is not the chosen one. */
      deepest?: PoolInfo;
      chosenLiquidity: bigint;
    }
  | { ok: false; reason: string };

/**
 * Checks a token and picks its pool: the one on fee tier `opts.fee` if given (a pinned or admin-chosen pool),
 * otherwise the deepest.
 */
export async function verifyStockToken(address: string, opts: { fee?: number } = {}): Promise<VerifyResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, reason: 'invalid address' };
  const token = address.toLowerCase() as Address;
  const a = stockAddresses();
  if (token === a.usdg) return { ok: false, reason: 'token is USDG' };
  try {
    const code = await stockChain.client.getCode({ address: token });
    if (!code || code === '0x') return { ok: false, reason: 'no contract code at address' };
    const meta = await readTokenMeta(token).catch(() => undefined);
    if (!meta?.symbol || meta.decimals < 0 || meta.decimals > 36) {
      return { ok: false, reason: 'not an ERC-20 (symbol/name/decimals unreadable)' };
    }
    const pools = await poolsFor(token);
    const deepest = pools[0];
    if (!deepest) return { ok: false, reason: 'no USDG pool for this token' };
    const chosen = opts.fee === undefined ? deepest : pools.find((p) => p.fee === opts.fee);
    if (!chosen) return { ok: false, reason: `no USDG pool on fee tier ${opts.fee}` };
    if (chosen.usdgMicros < minPoolUsdgMicros()) {
      return { ok: false, reason: `pool USDG liquidity ${chosen.usdgMicros} below minimum` };
    }
    return {
      ok: true,
      address: token,
      ...meta,
      poolFee: chosen.fee,
      poolAddress: chosen.pool,
      usdgLiquidityMicros: chosen.usdgMicros.toString(),
      chosenLiquidity: chosen.liquidity,
      ...(deepest.pool === chosen.pool ? {} : { deepest }),
    };
  } catch (err) {
    return { ok: false, reason: `chain read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
