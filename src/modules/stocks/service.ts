import { KNOWN } from '@spindle/shared/chain';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { stockTokens } from '../../db/schema';
import { logger } from '../../lib/logger';
import type { StockRow } from './quote';
import { type VerifyResult, verifyStockToken } from './verify';

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
  const [row] = await db.select().from(stockTokens).where(eq(stockTokens.address, address.toLowerCase()));
  return row;
}

export async function listEnabled() {
  const rows = await db.select().from(stockTokens).where(eq(stockTokens.enabled, true));
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

export const listAll = () => db.select().from(stockTokens);

/**
 * Admin upsert: metadata, pool and fee always come from on-chain verification, never the caller.
 * Enabling a token that fails verification is rejected (returns the failure).
 */
export async function upsertVerified(address: string, enabled: boolean) {
  const v = await verifyStockToken(address);
  if (!v.ok) {
    if (enabled) return v;
    // Disabling a token that now fails verification is always allowed.
    await db
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
  await db
    .insert(stockTokens)
    .values(values)
    .onConflictDoUpdate({ target: stockTokens.address, set: values });
  return v;
}

/** Daily re-verify: refreshes pool data of passing tokens, disables failing ones. */
export async function reverifyAll(): Promise<{ checked: number; disabled: string[] }> {
  const rows = await listAll();
  const disabled: string[] = [];
  for (const row of rows) {
    const v: VerifyResult = await verifyStockToken(row.address);
    if (v.ok) {
      await db
        .update(stockTokens)
        .set({ poolFee: v.poolFee, poolAddress: v.poolAddress, verifiedAt: new Date() })
        .where(eq(stockTokens.address, row.address));
    } else if (row.enabled) {
      // A transient RPC failure must not silently delist a token: only disable on definite failures.
      if (v.reason.startsWith('chain read failed')) continue;
      await db.update(stockTokens).set({ enabled: false }).where(eq(stockTokens.address, row.address));
      disabled.push(row.address);
      logger.warn({ token: row.address, reason: v.reason }, 'stock token disabled by re-verify');
    }
  }
  return { checked: rows.length, disabled };
}
