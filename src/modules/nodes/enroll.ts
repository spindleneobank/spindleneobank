import { createHash, randomBytes, randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { enrollments } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { nodeHub } from './hub';
import type { NodeRow } from './service';

export const TOKEN_PREFIX = 'spdl_enr_';
export const TOKEN_TTL_MS = 15 * 60_000;
export const PAIRING_TTL_MS = 30 * 60_000;
/** Crockford base32 without I, L, O, U. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

type Db = typeof dbRef.db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface EnrollmentMeta {
  engine: string;
  os: string;
  name?: string;
}

const metaKey = (id: string) => `node:enroll-meta:${id}`;

/** 32 random bytes, base64url, `spdl_enr_` prefix. Only the sha256 is stored. */
export async function createEnrollment(
  userId: string,
  meta: EnrollmentMeta,
  now = new Date(),
): Promise<{ enrollmentId: string; token: string; expiresAt: Date }> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  const [row] = await dbRef.db
    .insert(enrollments)
    .values({ userId, kind: 'token', tokenHash: sha256(token), status: 'pending', expiresAt })
    .returning({ id: enrollments.id });
  if (!row) throw new AppError('INTERNAL', 'Could not create the enrollment.');
  // The enrollments table has no column for the requested name/engine/os, so keep them briefly in Redis.
  await getRedis()
    .set(metaKey(row.id), JSON.stringify(meta), 'EX', Math.ceil(PAIRING_TTL_MS / 1000))
    .catch((err) => logger.warn({ err: String(err) }, 'enrollment meta not stored'));
  return { enrollmentId: row.id, token, expiresAt };
}

export async function readEnrollmentMeta(enrollmentId: string): Promise<EnrollmentMeta | null> {
  try {
    const raw = await getRedis().get(metaKey(enrollmentId));
    return raw ? (JSON.parse(raw) as EnrollmentMeta) : null;
  } catch {
    return null;
  }
}

export interface ConsumedToken {
  enrollmentId: string;
  userId: string;
}

/**
 * Single-use token consumption inside the caller's transaction (SELECT ... FOR UPDATE).
 * Returns null for unknown / used / expired tokens.
 */
export async function consumeTokenTx(
  tx: Tx,
  token: string,
  nodeKey: string,
  now = new Date(),
): Promise<ConsumedToken | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await tx
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.tokenHash, sha256(token)), eq(enrollments.kind, 'token')))
    .for('update')
    .limit(1);
  if (row?.status !== 'pending') return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await tx.update(enrollments).set({ status: 'expired' }).where(eq(enrollments.id, row.id));
    return null;
  }
  // claimed -> approved happen together: the node row is created in the same transaction.
  await tx
    .update(enrollments)
    .set({ status: 'approved', nodeKey: nodeKey.toLowerCase(), approvedAt: now })
    .where(eq(enrollments.id, row.id));
  return { enrollmentId: row.id, userId: row.userId };
}

/** Standalone variant: consumes the token in its own transaction. */
export function consumeToken(
  token: string,
  nodeKey: string,
  now = new Date(),
): Promise<ConsumedToken | null> {
  return dbRef.db.transaction((tx) => consumeTokenTx(tx, token, nodeKey, now));
}

// ---- pairing ---------------------------------------------------------------------------------

export interface Pairing {
  code: string;
  nodeKey: string;
  expiresAt: Date;
}

const pairings = new Map<string, Pairing>();

export function randomPairingCode(): string {
  const pick = () => CROCKFORD[randomInt(CROCKFORD.length)];
  const part = () => Array.from({ length: 4 }, pick).join('');
  return `${part()}-${part()}`;
}

/** Unique among live pairings and historic codes. A node key holds at most one live code. */
export async function createPairing(nodeKey: string, now = new Date()): Promise<Pairing> {
  const key = nodeKey.toLowerCase();
  for (const p of pairings.values()) if (p.nodeKey === key) pairings.delete(p.code);
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomPairingCode();
    if (pairings.has(code)) continue;
    const [used] = await dbRef.db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(eq(enrollments.pairingCode, code))
      .limit(1);
    if (used || pairings.has(code)) continue;
    const pairing = { code, nodeKey: key, expiresAt: new Date(now.getTime() + PAIRING_TTL_MS) };
    pairings.set(code, pairing);
    return pairing;
  }
  throw new AppError('INTERNAL', 'Could not allocate a pairing code.');
}

export function dropPairing(nodeKey: string): void {
  const key = nodeKey.toLowerCase();
  for (const p of pairings.values()) if (p.nodeKey === key) pairings.delete(p.code);
}

export function sweepPairings(now = Date.now()): void {
  for (const p of pairings.values()) if (p.expiresAt.getTime() <= now) pairings.delete(p.code);
}

export function livePairings(): number {
  return pairings.size;
}

/** Looks up a live pairing and removes it (one approval per code). */
export function takePairing(code: string, now = new Date()): Pairing | null {
  const p = pairings.get(code);
  if (!p) return null;
  pairings.delete(code);
  return p.expiresAt.getTime() > now.getTime() ? p : null;
}

/** Approves a pairing code for `userId`: creates the node, sends `welcome` to the live socket. */
export async function approvePairing(userId: string, rawCode: string): Promise<NodeRow> {
  const code = rawCode.trim().toUpperCase();
  const pairing = takePairing(code);
  if (!pairing) throw new AppError('NOT_FOUND', 'This pairing code is invalid or has expired.');
  const node = await nodeHub.completePairing(pairing, userId);
  if (!node)
    throw new AppError('NOT_FOUND', 'This node is no longer connected. Restart it to get a new code.');
  return node;
}
