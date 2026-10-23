import { KNOWN } from '@spindle/shared/chain';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { stockTokens } from '../../db/schema';
import { logger } from '../../lib/logger';
import type { StockRow } from './quote';
import { type VerifyResult, verifyStockToken } from './verify';

/** Dev bootstrap seed (X1 imports this). Pool fee/address are filled by verification. */
export const DEFAULT_STOCKS: readonly { address: string; symbol: string; name: string; decimals: number }[] =
  [{ address: KNOWN.NVDA.toLowerCase(), symbol: 'NVDA', name: 'NVIDIA', decimals: 18 }];

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
