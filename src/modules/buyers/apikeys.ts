import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { apiKeys } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { PostApiKeysReq } from '../../shared/api/buyer';
import { dbRef } from '../auth/constants';
import { requireFreshAuth, requireSession } from '../auth/middleware';
import { buyerIdForAddress } from './service';

export const KEY_PREFIX = 'sk-spdl-';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MAX_ACTIVE_KEYS = 20;

export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

/** 32 random bytes (256 bits) as base62, with the `sk-spdl-` prefix. */
export function generateKey(): string {
  let n = BigInt(`0x${randomBytes(32).toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  return KEY_PREFIX + out.padStart(43, '0');
}

export async function createApiKey(buyerId: string, name: string): Promise<{ id: string; key: string }> {
  const active = await dbRef.db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.buyerId, buyerId), isNull(apiKeys.revokedAt)));
  if (active.length >= MAX_ACTIVE_KEYS) {
    throw new AppError('CONFLICT', `You can have at most ${MAX_ACTIVE_KEYS} active API keys.`);
  }
  const key = generateKey();
  const [row] = await dbRef.db
    .insert(apiKeys)
    .values({ buyerId, name, keyPrefix: key.slice(0, 12), keyHash: hashKey(key) })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error('api key insert returned no row');
  return { id: row.id, key };
}

const lastUsedWritten = new Map<string, number>();
const LAST_USED_DEBOUNCE_MS = 60_000;

/**
 * Resolve a plain key to its buyer. The lookup is an indexed equality on the sha256 (unique), so
 * there is no early-exit string comparison of secrets. Returns null for unknown or revoked keys.
 */
export async function verifyApiKey(key: string): Promise<{ keyId: string; buyerId: string } | null> {
  if (!key.startsWith(KEY_PREFIX) || key.length > 128) return null;
  const [row] = await dbRef.db
    .select({ id: apiKeys.id, buyerId: apiKeys.buyerId, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashKey(key)))
    .limit(1);
  if (!row || row.revokedAt) return null;
  const now = Date.now();
  if (now - (lastUsedWritten.get(row.id) ?? 0) > LAST_USED_DEBOUNCE_MS) {
    lastUsedWritten.set(row.id, now);
    void dbRef.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiKeys.id, row.id))
      .catch(() => lastUsedWritten.delete(row.id));
  }
  return { keyId: row.id, buyerId: row.buyerId };
}

export function apiKeyRoutes(app: Hono<Env>): void {
  const buyerOf = (address: string | undefined) => {
    if (!address) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
    return buyerIdForAddress(address);
  };

  app.get('/v1/app/api-keys', requireSession, async (c) => {
    const buyerId = await buyerOf(c.get('user')?.address);
    const rows = await dbRef.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.buyerId, buyerId))
      .orderBy(desc(apiKeys.createdAt));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name ?? '',
        prefix: r.keyPrefix,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
      })),
    );
  });

  app.post('/v1/app/api-keys', requireSession, requireFreshAuth, async (c) => {
    const parsed = PostApiKeysReq.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      throw new AppError('VALIDATION', 'Invalid request body.', 400, parsed.error.flatten());
    const buyerId = await buyerOf(c.get('user')?.address);
    const created = await createApiKey(buyerId, parsed.data.name.trim());
    c.header('cache-control', 'no-store');
    return c.json(created, 201);
  });

  app.delete('/v1/app/api-keys/:id', requireSession, async (c) => {
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('NOT_FOUND', 'API key not found.');
    const buyerId = await buyerOf(c.get('user')?.address);
    const rows = await dbRef.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.buyerId, buyerId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (rows.length === 0) throw new AppError('NOT_FOUND', 'API key not found.');
    return c.body(null, 204);
  });
}
