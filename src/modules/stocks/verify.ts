import type { Address } from 'viem';
import { publicClient } from '../../lib/viem';
import { erc20Abi, FEE_TIERS, factoryAbi, stockAddresses } from './abi';

const ZERO = '0x0000000000000000000000000000000000000000';

export const minPoolUsdgMicros = () => BigInt(process.env.STOCK_MIN_POOL_USDG ?? '50000') * 1_000_000n;

export type PoolInfo = { fee: number; pool: Address; usdgMicros: bigint };

/** Deepest USDG/token pool across fee tiers by USDG balance (undefined when none exist). */
export async function deepestPool(token: Address): Promise<PoolInfo | undefined> {
  const a = stockAddresses();
  const found: (PoolInfo | undefined)[] = await Promise.all(
    FEE_TIERS.map(async (fee): Promise<PoolInfo | undefined> => {
      const pool = await publicClient.readContract({
        address: a.factory,
        abi: factoryAbi,
        functionName: 'getPool',
        args: [a.usdg, token, fee],
      });
      if (pool === ZERO) return undefined;
      const usdgMicros = await publicClient.readContract({
        address: a.usdg,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [pool],
      });
      return { fee, pool: pool.toLowerCase() as Address, usdgMicros };
    }),
  );
  return found
    .filter((p): p is PoolInfo => p !== undefined)
    .sort((x, y) => (x.usdgMicros < y.usdgMicros ? 1 : x.usdgMicros > y.usdgMicros ? -1 : 0))[0];
}

export async function readTokenMeta(token: Address) {
  const [symbol, name, decimals] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
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
    }
  | { ok: false; reason: string };

export async function verifyStockToken(address: string): Promise<VerifyResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, reason: 'invalid address' };
  const token = address.toLowerCase() as Address;
  const a = stockAddresses();
  if (token === a.usdg) return { ok: false, reason: 'token is USDG' };
  try {
    const code = await publicClient.getCode({ address: token });
    if (!code || code === '0x') return { ok: false, reason: 'no contract code at address' };
    const meta = await readTokenMeta(token).catch(() => undefined);
    if (!meta?.symbol || meta.decimals < 0 || meta.decimals > 36) {
      return { ok: false, reason: 'not an ERC-20 (symbol/name/decimals unreadable)' };
    }
    const best = await deepestPool(token);
    if (!best) return { ok: false, reason: 'no USDG pool for this token' };
    if (best.usdgMicros < minPoolUsdgMicros()) {
      return { ok: false, reason: `deepest pool USDG liquidity ${best.usdgMicros} below minimum` };
    }
    return {
      ok: true,
      address: token,
      ...meta,
      poolFee: best.fee,
      poolAddress: best.pool,
      usdgLiquidityMicros: best.usdgMicros.toString(),
    };
  } catch (err) {
    return { ok: false, reason: `chain read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
