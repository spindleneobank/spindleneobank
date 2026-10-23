/** Dev/admin helper: `bun run src/modules/stocks/discover.ts [extraTokenAddr...]`. Prints proposed stock_tokens rows; never inserts. */
import { KNOWN } from '@spindle/shared/chain';
import type { Address } from 'viem';
import { logsClient, publicClient } from '../../lib/viem';
import { factoryAbi, stockAddresses } from './abi';
import { deepestPool, minPoolUsdgMicros, readTokenMeta } from './verify';

const CHUNK = 9_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 6) throw err;
      await sleep(4000 * (attempt + 1)); // public RPC rate-limits eth_getLogs
    }
  }
}

/** Tokens paired with USDG in any factory `PoolCreated` event (scans in <=9M-block chunks). */
export async function scanUsdgPairedTokens(): Promise<Address[]> {
  const a = stockAddresses();
  const head = await publicClient.getBlockNumber();
  const found = new Set<Address>();
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
        if (other) found.add(other.toLowerCase() as Address);
      }
    }
  }
  return [...found];
}

export async function propose(candidates: Address[]) {
  const rows: Record<string, unknown>[] = [];
  for (const token of candidates) {
    try {
      const [meta, best] = await Promise.all([readTokenMeta(token), deepestPool(token)]);
      if (!best) continue;
      rows.push({
        address: token,
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        poolFee: best.fee,
        poolAddress: best.pool,
        usdgLiquidity: Number(best.usdgMicros) / 1e6,
        meetsMinimum: best.usdgMicros >= minPoolUsdgMicros(),
      });
    } catch {
      // not an ERC-20 / unreadable: skip
    }
  }
  return rows.sort((x, y) => Number(y.usdgLiquidity) - Number(x.usdgLiquidity));
}

if (import.meta.main) {
  const extra = process.argv.slice(2).map((s) => s.toLowerCase() as Address);
  const scanned = await scanUsdgPairedTokens();
  const all = [...new Set([KNOWN.NVDA.toLowerCase() as Address, ...extra, ...scanned])];
  console.error(`candidates: ${all.length}`);
  console.log(JSON.stringify(await propose(all), null, 2));
  process.exit(0);
}
