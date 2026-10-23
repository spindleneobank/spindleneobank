/** Dev/admin helper: `bun run src/modules/stocks/discover.ts `. Prints proposed stock_tokens rows; never inserts. */
import type { Address } from 'viem';
import { logsClient, publicClient } from '../../lib/viem';
import { erc20Abi, factoryAbi, stockAddresses } from './abi';
import { minPoolUsdgMicros, type PoolInfo, readTokenMeta } from './verify';

const CHUNK = 9_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      await sleep(1500); // pace requests: the public RPC 429s after a few eth_getLogs calls
      return await fn();
    } catch (err) {
      if (attempt >= 8) throw err;
      await sleep(5000 * (attempt + 1));
    }
  }
}

type UsdgPool = { token: Address; fee: number; pool: Address };

/** Every USDG pool from factory `PoolCreated` events (scans in <=9M-block chunks). */
export async function scanUsdgPools(): Promise<UsdgPool[]> {
  const a = stockAddresses();
  const head = await publicClient.getBlockNumber();
  const found = new Map<Address, UsdgPool>();
  for (let from = 0n; from <= head; from += CHUNK) {
    let to = from + CHUNK - 1n;
    if (to > head) to = head;
    for (const side of ['token0', 'token1'] as const) {
      const logs = await withBackoff(() =>
        logsClient.getLogs({
          address: a.factory,
          event: factoryAbi[1],
          args: { [side]: a.usdg } as never,
          fromBlock: from,
          toBlock: to,
        }),
      );
      for (const l of logs) {
        const other = side === 'token0' ? l.args.token1 : l.args.token0;
        if (!other || !l.args.pool || l.args.fee === undefined) continue;
        const pool = l.args.pool.toLowerCase() as Address;
        found.set(pool, { token: other.toLowerCase() as Address, fee: l.args.fee, pool });
      }
    }
  }
  return [...found.values()];
}

/** USDG balance of each pool via multicall (batched), keeping pools at or above `minMicros`. */
export async function liquidPools(
  pools: UsdgPool[],
  minMicros: bigint,
): Promise<(UsdgPool & { usdgMicros: bigint })[]> {
  const a = stockAddresses();
  const out: (UsdgPool & { usdgMicros: bigint })[] = [];
  for (let i = 0; i < pools.length; i += 300) {
    const batch = pools.slice(i, i + 300);
    const res = await withBackoff(() =>
      publicClient.multicall({
        allowFailure: true,
        contracts: batch.map((p) => ({
          address: a.usdg,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [p.pool] as const,
        })),
      }),
    );
    batch.forEach((p, j) => {
      const r = res[j];
      if (r?.status === 'success' && r.result >= minMicros) out.push({ ...p, usdgMicros: r.result });
    });
  }
  return out;
}

export async function propose(pools: (UsdgPool & { usdgMicros: bigint })[]) {
  const best = new Map<Address, PoolInfo>();
  for (const p of pools) {
    const cur = best.get(p.token);
    if (!cur || p.usdgMicros > cur.usdgMicros)
      best.set(p.token, { fee: p.fee, pool: p.pool, usdgMicros: p.usdgMicros });
  }
  const rows: Record<string, unknown>[] = [];
  for (const [token, b] of best) {
    try {
      const meta = await readTokenMeta(token);
      rows.push({
        address: token,
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        poolFee: b.fee,
        poolAddress: b.pool,
        usdgLiquidity: Number(b.usdgMicros) / 1e6,
      });
    } catch {
      // not an ERC-20 / unreadable: skip
    }
  }
  return rows.sort((x, y) => Number(y.usdgLiquidity) - Number(x.usdgLiquidity));
}

if (import.meta.main) {
  const min = minPoolUsdgMicros();
  const all = await scanUsdgPools();
  console.error(`USDG pools: ${all.length}`);
  const liquid = await liquidPools(all, min);
  console.error(`pools >= ${min / 1_000_000n} USDG: ${liquid.length}`);
  console.log(JSON.stringify(await propose(liquid), null, 2));
  process.exit(0);
}
