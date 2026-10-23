import { eq, like } from 'drizzle-orm';
import { kv } from '../../db/schema';
import type { Tx } from '../../db/types';
import { dec, enc } from './codec';
import { type IndexedLog, logKey } from './handlers';

export const PENDING_PREFIX = 'indexer:pending:';
export const RESYNC_KEY = 'indexer:stake_resync';

type Stored = { events: unknown[] };

export async function appendPending(tx: Tx, key: string, log: IndexedLog): Promise<void> {
  const k = PENDING_PREFIX + key;
  const [row] = await tx.select().from(kv).where(eq(kv.key, k));
  const events = ((row?.value as Stored | undefined)?.events ?? []).map((e) => dec(e) as IndexedLog);
  if (!events.some((e) => logKey(e) === logKey(log))) events.push(log);
  const value = { events: events.map(enc) };
  await tx
    .insert(kv)
    .values({ key: k, value })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });
}

/** All parked events by key (node-key entries first so ids get assigned before id-keyed entries). */
export async function loadPending(tx: Tx): Promise<{ key: string; events: IndexedLog[] }[]> {
  const rows = await tx
    .select()
    .from(kv)
    .where(like(kv.key, `${PENDING_PREFIX}%`));
  return rows
    .map((r) => ({
      key: r.key.slice(PENDING_PREFIX.length),
      events: ((r.value as Stored).events ?? []).map((e) => dec(e) as IndexedLog),
    }))
    .sort((a, b) => Number(b.key.startsWith('0x')) - Number(a.key.startsWith('0x')));
}

export async function deletePending(tx: Tx, key: string): Promise<void> {
  await tx.delete(kv).where(eq(kv.key, PENDING_PREFIX + key));
}

/** Drop parked events from blocks above `ancestor` (they were reorged away). */
export async function dropPendingAbove(tx: Tx, ancestor: number): Promise<void> {
  for (const p of await loadPending(tx)) {
    const keep = p.events.filter((e) => e.blockNumber <= BigInt(ancestor));
    if (keep.length === p.events.length) continue;
    if (keep.length === 0) await deletePending(tx, p.key);
    else {
      await tx
        .update(kv)
        .set({ value: { events: keep.map(enc) } })
        .where(eq(kv.key, PENDING_PREFIX + p.key));
    }
  }
}

export async function readResync(tx: Tx): Promise<string[]> {
  const [row] = await tx.select().from(kv).where(eq(kv.key, RESYNC_KEY));
  return ((row?.value as { nodes?: string[] } | undefined)?.nodes ?? []).map(String);
}

export async function writeResync(tx: Tx, nodeIds: string[]): Promise<void> {
  const value = { nodes: [...new Set(nodeIds)] };
  await tx
    .insert(kv)
    .values({ key: RESYNC_KEY, value })
    .onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } });
}
