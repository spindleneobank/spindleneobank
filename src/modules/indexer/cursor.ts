import { eq, sql } from 'drizzle-orm';
import { kv } from '../../db/schema';
import type { Tx } from '../../db/types';

export const CURSOR_KEY = 'indexer:cursor';
export const RECENT_KEEP = 64;

export type BlockRef = { number: number; hash: string };
export type Cursor = { lastSafeBlock: number; recent: BlockRef[] };

/** Initial cursor: the block before DEPLOY_BLOCK has been "applied" (nothing precedes the deployment). */
export function initialCursor(deployBlock: number): Cursor {
  return { lastSafeBlock: deployBlock - 1, recent: [] };
}

export async function readCursor(db: Tx, deployBlock: number): Promise<Cursor> {
  const [row] = await db.select({ value: kv.value }).from(kv).where(eq(kv.key, CURSOR_KEY));
  const v = row?.value as Partial<Cursor> | undefined;
  if (!v || typeof v.lastSafeBlock !== 'number') return initialCursor(deployBlock);
  // a cursor from before DEPLOY_BLOCK (contracts redeployed later) would crawl history that holds none of our events
  if (v.lastSafeBlock < deployBlock - 1) return initialCursor(deployBlock);
  return { lastSafeBlock: v.lastSafeBlock, recent: Array.isArray(v.recent) ? v.recent : [] };
}

export async function writeCursor(db: Tx, cursor: Cursor): Promise<void> {
  const value = { lastSafeBlock: cursor.lastSafeBlock, recent: cursor.recent.slice(-RECENT_KEEP) };
  await db
    .insert(kv)
    .values({ key: CURSOR_KEY, value })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: sql`now()` } });
}

/** Add a block hash to the window (replacing any entry for the same number), keep the newest 64. */
export function pushRecent(recent: BlockRef[], ref: BlockRef): BlockRef[] {
  return [...recent.filter((r) => r.number < ref.number), ref].slice(-RECENT_KEEP);
}
