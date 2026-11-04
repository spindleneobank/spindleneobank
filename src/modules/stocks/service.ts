import { KNOWN } from '@spindle/shared/chain';
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client';
import { auditLog, stockTokens } from '../../db/schema';
import { sendAlert } from '../../lib/alerts';
import { logger } from '../../lib/logger';
import type { StockRow } from './quote';
import { type VerifyResult, verifyStockToken } from './verify';

/** Test seam: tests point this at the throwaway test database. */
export const stockDb: { db: typeof defaultDb } = { db: defaultDb };

/** Dev bootstrap seed (X1 imports this). Pool fee/address are filled by verification. */
export const DEFAULT_STOCKS: readonly { address: string; symbol: string; name: string; decimals: number }[] =
  [
    { address: KNOWN.NVDA.toLowerCase(), symbol: 'NVDA', name: 'NVIDIA', decimals: 18 },
    { address: '0x322f0929c4625ed5bad873c95208d54e1c003b2d', symbol: 'TSLA', name: 'Tesla', decimals: 18 },
    { address: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', symbol: 'AAPL', name: 'Apple', decimals: 18 },
    {
      address: '0xe93237c50d904957cf27e7b1133b510c669c2e74',
      symbol: 'MSFT',
      name: 'Microsoft',
      decimals: 18,
    },
    { address: '0x12f190a9f9d7d37a250758b26824b97ce941bf54', symbol: 'AMZN', name: 'Amazon', decimals: 18 },
    { address: '0x4ea005168d7f09a7a0ba9d1def21a479950e44c2', symbol: 'COST', name: 'Costco', decimals: 18 },
    { address: '0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5', symbol: 'CRCL', name: 'Circle', decimals: 18 },
    {
      address: '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68',
      symbol: 'QQQ',
      name: 'Invesco QQQ',
      decimals: 18,
    },
    {
      address: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF',
      decimals: 18,
    },
  ];

export async function getStock(address: string): Promise<StockRow | undefined> {
  const [row] = await stockDb.db
    .select()
    .from(stockTokens)
    .where(eq(stockTokens.address, address.toLowerCase()));
  return row;
}

export async function listEnabled() {
  const rows = await stockDb.db.select().from(stockTokens).where(eq(stockTokens.enabled, true));
  return rows
    .filter((r) => r.poolFee != null)
    .map((r) => ({
      address: r.address,
      symbol: r.symbol,
      name: r.name ?? r.symbol,
      decimals: r.decimals,
      poolFee: r.poolFee as number,
    }));
}

export const listAll = () => stockDb.db.select().from(stockTokens);

/**
 * Admin upsert: metadata, pool and fee always come from on-chain verification, never the caller. This is where
 * a pool gets pinned. A token that already has one keeps it unless the admin names another fee tier, so
 * re-enabling a token after a pool alert cannot switch it to the pool that raised the alert.
 * Enabling a token that fails verification is rejected (returns the failure).
 */
export async function upsertVerified(address: string, enabled: boolean, opts: { poolFee?: number } = {}) {
  const existing = await getStock(address);
  const fee = opts.poolFee ?? existing?.poolFee ?? undefined;
  const v = await verifyStockToken(address, fee === undefined ? {} : { fee });
  if (!v.ok) {
    if (enabled) return v;
    // Disabling a token that now fails verification is always allowed.
    await stockDb.db
      .update(stockTokens)
      .set({ enabled: false })
      .where(eq(stockTokens.address, address.toLowerCase()));
    return v;
  }
  const values = {
    address: v.address,
    symbol: v.symbol,
    name: v.name,
    decimals: v.decimals,
    poolFee: v.poolFee,
    poolAddress: v.poolAddress,
    verifiedAt: new Date(),
    enabled,
  };
  await stockDb.db
    .insert(stockTokens)
    .values(values)
    .onConflictDoUpdate({ target: stockTokens.address, set: values });
  return v;
}

/**
 * A deeper pool only matters once it is clearly deeper: `liquidity()` moves day to day, and disabling a token on
 * every small lead would take it offline for no reason.
 */
export const DEEPER_POOL_FACTOR = 2n;

async function disableWithAlert(token: string, reason: string, details: Record<string, unknown>) {
  await sendAlert(`stock-disabled:${token}`, 'critical', `Stock token disabled: ${reason}`, {
    token,
    ...details,
  });
  await stockDb.db.update(stockTokens).set({ enabled: false }).where(eq(stockTokens.address, token));
  await stockDb.db.insert(auditLog).values({
    actor: 'system:stocks-reverify',
    action: 'stock.disabled',
    subject: token,
    details: { reason, ...details },
  });
}

async function alertDeeperPool(token: string, pinned: string, deeper: { pool: string; fee: number }) {
  await sendAlert(`stock-deeper:${token}`, 'warning', 'A stock pool is deeper than the pinned one', {
    token,
    pinned,
    deeper: deeper.pool,
  });
  await stockDb.db.insert(auditLog).values({
    actor: 'system:stocks-reverify',
    action: 'stock.deeper_pool',
    subject: token,
    details: { pinned, deeper: deeper.pool, deeperFee: deeper.fee },
  });
}

/**
 * Daily re-verify. It only refreshes data and checks the pinned pool, and never switches pools: a permissionless
 * factory means any pool found here may be an attacker's. A token whose pinned pool went bad is disabled with an
 * alert. A pool that overtakes the pinned one only raises an alert: swaps stay on the pin, so it cannot hurt
 * buyers, and a narrow position can make `liquidity()` large for very little, so disabling on it would let anyone
 * keep a token offline.
 */
export async function reverifyAll(): Promise<{ checked: number; disabled: string[]; alerts: string[] }> {
  const rows = await listAll();
  const disabled: string[] = [];
  const alerts: string[] = [];
  for (const row of rows) {
    if (row.poolFee == null || !row.poolAddress) continue; // not verified by an admin yet: nothing is pinned
    const v: VerifyResult = await verifyStockToken(row.address, { fee: row.poolFee });
    // A transient RPC failure must not silently delist a token: only disable on definite failures.
    if (!v.ok && v.reason.startsWith('chain read failed')) continue;
    if (v.ok && v.poolAddress !== row.poolAddress) {
      if (row.enabled) {
        await disableWithAlert(row.address, 'pool on the pinned fee tier changed', { found: v.poolAddress });
        disabled.push(row.address);
      }
      continue;
    }
    if (!v.ok) {
      if (row.enabled) {
        await disableWithAlert(row.address, v.reason, {});
        disabled.push(row.address);
      }
      continue;
    }
    await stockDb.db
      .update(stockTokens)
      .set({ symbol: v.symbol, name: v.name, decimals: v.decimals, verifiedAt: new Date() })
      .where(eq(stockTokens.address, row.address));
    if (row.enabled && v.deepest && v.deepest.liquidity > v.chosenLiquidity * DEEPER_POOL_FACTOR) {
      alerts.push(row.address);
      await alertDeeperPool(row.address, row.poolAddress, v.deepest);
    }
  }
  return { checked: rows.length, disabled, alerts };
}
