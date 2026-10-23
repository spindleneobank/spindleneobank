import type { Address } from 'viem';
import { config } from '../../config';
import { sql } from '../../db/client';
import { getEthUsdMicros } from '../../lib/ethPrice';
import { keeperAccount, keeperBalance } from '../../lib/keeper';
import { publicClient } from '../../lib/viem';

export type KeeperLevel = 'ok' | 'low' | 'critical';
export type KeeperState = {
  address: Address;
  balanceWei: string;
  ethUsdMicros: string;
  gasPriceWei: string;
  level: KeeperLevel;
  checkedAt: string;
};

export const KEEPER_KV_KEY = 'keeper';

export function keeperLevel(balanceWei: bigint): KeeperLevel {
  if (balanceWei < BigInt(config.KEEPER_CRITICAL_ETH_WEI)) return 'critical';
  if (balanceWei < BigInt(config.KEEPER_MIN_ETH_WEI)) return 'low';
  return 'ok';
}

export type KvStore = {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

/** Postgres `kv` table (key text pk, value jsonb, updated_at). */
export const pgKv: KvStore = {
  async get(key) {
    const rows = await sql`select value from kv where key = ${key}`;
    return rows[0]?.value;
  },
  async set(key, value) {
    await sql`insert into kv (key, value, updated_at) values (${key}, ${sql.json(value as never)}, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
  },
};

/** Computes the keeper state live from the chain. */
export async function computeKeeperState(now = new Date()): Promise<KeeperState> {
  const [balance, gasPrice, ethUsd] = await Promise.all([
    keeperBalance(),
    publicClient.getGasPrice(),
    getEthUsdMicros().catch(() => 0n),
  ]);
  return {
    address: keeperAccount().address,
    balanceWei: balance.toString(),
    ethUsdMicros: ethUsd.toString(),
    gasPriceWei: gasPrice.toString(),
    level: keeperLevel(balance),
    checkedAt: now.toISOString(),
  };
}

/** Last gas-monitor result from kv('keeper'), or computed live if missing. */
export async function keeperState(kv: KvStore = pgKv): Promise<KeeperState> {
  const stored = await kv.get(KEEPER_KV_KEY).catch(() => undefined);
  if (stored && typeof stored === 'object') return stored as KeeperState;
  return computeKeeperState();
}
