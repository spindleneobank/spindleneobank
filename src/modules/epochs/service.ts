import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { desc, eq, lt } from 'drizzle-orm';
import { config } from '../../config';
import { epochs } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { EpochStatus } from '../../shared/enums';
import { dbRef } from '../auth/constants';
import { CLAIM_DELAY_MS } from '../metering/service';

export { CLAIM_DELAY_MS };

/** Runtime settings (config is frozen; tests override). */
export const epochSettings = {
  treesDir: config.TREES_DIR,
  epochSeconds: config.EPOCH_SECONDS,
  claimMinMicros: BigInt(config.CLAIM_MIN_USDG_MICROS),
};

export function treeFile(epoch: bigint | number): string {
  return `${epoch}.json`;
}
export function treePathOf(name: string): string {
  return join(epochSettings.treesDir, name);
}

/** Atomic write: tmp file in the same directory, then rename. Readers never see a partial file. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** Epoch number of the hour that just closed at `now`. */
export function closedEpochAt(now: Date): bigint {
  return BigInt(Math.floor(now.getTime() / 1000 / epochSettings.epochSeconds)) - 1n;
}
export function epochEnd(epoch: bigint): Date {
  return new Date(Number(epoch + 1n) * epochSettings.epochSeconds * 1000);
}

export type EpochRow = typeof epochs.$inferSelect;

export async function latestPostedEpoch(): Promise<EpochRow | undefined> {
  const [row] = await dbRef.db
    .select()
    .from(epochs)
    .where(eq(epochs.status, 'posted'))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  return row;
}

export async function getEpoch(epoch: bigint): Promise<EpochRow | undefined> {
  const [row] = await dbRef.db.select().from(epochs).where(eq(epochs.epoch, epoch));
  return row;
}

export async function latestEpochView() {
  const row = await latestPostedEpoch();
  if (!row) throw new AppError('NOT_FOUND', 'No epoch has been posted yet.', 404);
  return {
    epoch: Number(row.epoch),
    root: row.root,
    totalEarned: row.totalEarnedUsdgMicros.toString(),
    postedAt: row.postedAt ? row.postedAt.toISOString() : null,
    txHash: row.txHash,
    claimableAt: row.postedAt ? new Date(row.postedAt.getTime() + CLAIM_DELAY_MS).toISOString() : null,
  };
}

/** Absolute path of the epoch's tree file, only for epochs that exist and whose file is on disk. */
export async function epochTreePath(epoch: bigint): Promise<string> {
  const row = await getEpoch(epoch);
  if (!row || row.status === 'failed') throw new AppError('NOT_FOUND', 'Unknown epoch.', 404);
  const p = treePathOf(row.treePath);
  if (!existsSync(p)) throw new AppError('NOT_FOUND', 'Tree file missing.', 404);
  return p;
}

/** Epochs newest first. Cursor is the last epoch number of the previous page. */
export async function listEpochs(q: { cursor?: string; limit: number }) {
  const rows = await dbRef.db
    .select()
    .from(epochs)
    .where(q.cursor ? lt(epochs.epoch, BigInt(q.cursor)) : undefined)
    .orderBy(desc(epochs.epoch))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      epoch: Number(r.epoch),
      root: r.root,
      totalEarned: r.totalEarnedUsdgMicros.toString(),
      owners: r.owners,
      status: r.status as EpochStatus,
      postedAt: r.postedAt ? r.postedAt.toISOString() : null,
      txHash: r.txHash,
      claimableAt: r.postedAt ? new Date(r.postedAt.getTime() + CLAIM_DELAY_MS).toISOString() : null,
    })),
    nextCursor: rows.length > q.limit && last ? last.epoch.toString() : null,
  };
}
