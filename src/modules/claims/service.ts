import { readFile } from 'node:fs/promises';
import { spindleClaimsAbi } from '@spindle/shared/abi';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { claims, epochs } from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { AppError } from '../../lib/errors';
import { publicClient } from '../../lib/viem';
import { proofFor, treeFromJson } from '../../shared/merkle';
import { dbRef } from '../auth/constants';
import { CLAIM_DELAY_MS, epochSettings, treePathOf } from '../epochs/service';

export interface ProofDeps {
  now(): Date;
  /** SpindleClaims.claimed(owner) */
  claimedOnchain(owner: Address): Promise<bigint>;
  claimsAddress(): Address;
}

export const defaultProofDeps: ProofDeps = {
  now: () => new Date(),
  claimsAddress: () => requireAddress('claims'),
  claimedOnchain: (owner) =>
    publicClient.readContract({
      address: requireAddress('claims'),
      abi: spindleClaimsAbi,
      functionName: 'claimed',
      args: [owner],
    }) as Promise<bigint>,
};

/** Newest posted, non-vetoed epoch whose claim delay has elapsed. */
export async function latestClaimableEpoch(now: Date) {
  const [row] = await dbRef.db
    .select()
    .from(epochs)
    .where(and(eq(epochs.status, 'posted'), lte(epochs.postedAt, new Date(now.getTime() - CLAIM_DELAY_MS))))
    .orderBy(desc(epochs.epoch))
    .limit(1);
  return row;
}

export async function getProof(owner: string, deps: ProofDeps = defaultProofDeps) {
  const o = owner.toLowerCase() as Address;
  const epoch = await latestClaimableEpoch(deps.now());
  if (!epoch)
    throw new AppError('CHAIN_STATE', 'Nothing is claimable yet.', 409, { reason: 'no-claimable-root' });
  let tree: ReturnType<typeof treeFromJson>;
  try {
    tree = treeFromJson(JSON.parse(await readFile(treePathOf(epoch.treePath), 'utf8')));
  } catch {
    throw new AppError('INTERNAL', 'Tree file unavailable.', 500);
  }
  let proof: Hex[];
  let cumulative = 0n;
  try {
    proof = proofFor(tree, o);
    for (const [, v] of tree.entries()) if (v[0] === o) cumulative = BigInt(v[1] as string);
  } catch {
    throw new AppError('CHAIN_STATE', 'Nothing is claimable yet.', 409, {
      reason: 'not-in-root',
      epoch: Number(epoch.epoch),
    });
  }
  const claimed = await deps.claimedOnchain(o);
  const claimable = cumulative > claimed ? cumulative - claimed : 0n;
  const amounts = {
    epoch: Number(epoch.epoch),
    cumulativeMicros: cumulative.toString(),
    claimedMicros: claimed.toString(),
    claimableMicros: claimable.toString(),
    minClaimMicros: epochSettings.claimMinMicros.toString(),
  };
  if (claimable === 0n)
    throw new AppError('CHAIN_STATE', 'Nothing is claimable yet.', 409, { reason: 'zero', ...amounts });
  if (claimable < epochSettings.claimMinMicros)
    throw new AppError('CHAIN_STATE', 'Claimable amount is below the minimum.', 409, {
      reason: 'below-minimum',
      belowMinimum: true,
      ...amounts,
    });
  return {
    epoch: Number(epoch.epoch),
    cumulativeMicros: cumulative.toString(),
    proof,
    claimedMicros: claimed.toString(),
    claimableMicros: claimable.toString(),
    contract: deps.claimsAddress(),
    abiFn: 'claim' as const,
  };
}

function parseCursor(c: string | undefined): [string, string] | null {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString());
    if (
      Array.isArray(v) &&
      typeof v[0] === 'string' &&
      typeof v[1] === 'string' &&
      !Number.isNaN(Date.parse(v[0]))
    )
      return [v[0], v[1]];
  } catch {}
  throw new AppError('VALIDATION', 'Invalid cursor.', 400);
}

export async function listClaims(owner: string, q: { cursor?: string; limit: number }) {
  const o = owner.toLowerCase();
  const cur = parseCursor(q.cursor);
  const rows = await dbRef.db
    .select()
    .from(claims)
    .where(and(eq(claims.owner, o), cur ? sqlBefore(cur) : undefined))
    .orderBy(desc(claims.createdAt), desc(claims.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      epoch: Number(r.epoch),
      amountMicros: r.amountUsdgMicros.toString(),
      txHash: r.txHash,
      blockNumber: r.blockNumber === null ? null : Number(r.blockNumber),
      status: r.status as 'submitted' | 'confirmed' | 'failed',
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor:
      rows.length > q.limit && last
        ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url')
        : null,
  };
}

import { sql } from 'drizzle-orm';

function sqlBefore(cur: [string, string]) {
  return sql`(${claims.createdAt}, ${claims.id}) < (${cur[0]}::timestamptz, ${cur[1]}::uuid)`;
}
