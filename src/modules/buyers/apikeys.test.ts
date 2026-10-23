import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { apiKeys, sessions } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { createApiKey, generateKey, hashKey, verifyApiKey } from './apikeys';
import buyerRoutes from './routes';
import { buyerIdForAddress, release, reserve, settleCharge } from './service';

let t: TestDb;
let app: Hono<Env>;
const ADDR = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const ORIGIN = 'http://localhost:7300';

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  settings.corsOrigins.push(ORIGIN);
  app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  buyerRoutes(app);
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(() => t.reset());

const call = async (method: string, path: string, s: { headers: Record<string, string> }, body?: unknown) =>
  app.request(path, {
    method,
    headers: { ...s.headers, origin: ORIGIN, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('key format', () => {
  test('sk-spdl- + 43 base62 chars, unique', () => {
    const a = generateKey();
    expect(a).toMatch(/^sk-spdl-[0-9A-Za-z]{43}$/);
    expect(generateKey()).not.toBe(a);
  });
});

describe('api key routes', () => {
  test('POST returns the key once; only sha256 + 12 char prefix are stored', async () => {
    const s = await createTestSession(ADDR);
    const res = await call('POST', '/v1/app/api-keys', s, { name: 'ci' });
    expect(res.status).toBe(201);
    const { id, key } = (await res.json()) as { id: string; key: string };
    expect(key).toMatch(/^sk-spdl-/);
    const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(row?.keyHash).toBe(hashKey(key));
    expect(row?.keyPrefix).toBe(key.slice(0, 12));
    expect(JSON.stringify(row)).not.toContain(key);

    const list = (await (await call('GET', '/v1/app/api-keys', s)).json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id,
      name: 'ci',
      prefix: key.slice(0, 12),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(list)).not.toContain(key);
  });

  test('POST requires fresh auth', async () => {
    const s = await createTestSession(ADDR);
    await t.db.update(sessions).set({ freshUntil: new Date(Date.now() - 1000) });
    const res = await call('POST', '/v1/app/api-keys', s, { name: 'x' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('REAUTH_REQUIRED');
    expect(await t.db.select().from(apiKeys)).toHaveLength(0);
  });

  test('requires a session, validates the body, and enforces CSRF', async () => {
    expect((await call('GET', '/v1/app/api-keys', { headers: {} })).status).toBe(401);
    const s = await createTestSession(ADDR);
    expect((await call('POST', '/v1/app/api-keys', s, { name: '' })).status).toBe(400);
    const noCsrf = await app.request('/v1/app/api-keys', {
      method: 'POST',
      headers: { cookie: s.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(noCsrf.status).toBe(403);
  });

  test('DELETE revokes (204), is owner scoped, and a revoked key no longer verifies', async () => {
    const s = await createTestSession(ADDR);
    const { id, key } = (await (await call('POST', '/v1/app/api-keys', s, { name: 'k' })).json()) as {
      id: string;
      key: string;
    };
    expect(await verifyApiKey(key)).toMatchObject({ keyId: id });

    const other = await createTestSession(privateKeyToAccount(generatePrivateKey()).address);
    expect((await call('DELETE', `/v1/app/api-keys/${id}`, other)).status).toBe(404);
    expect(await verifyApiKey(key)).not.toBeNull();

    expect((await call('DELETE', `/v1/app/api-keys/${id}`, s)).status).toBe(204);
    expect(await verifyApiKey(key)).toBeNull();
    expect((await call('DELETE', `/v1/app/api-keys/${id}`, s)).status).toBe(404);
    expect((await call('DELETE', '/v1/app/api-keys/not-a-uuid', s)).status).toBe(404);
  });
});

describe('verifyApiKey', () => {
  test('unknown / malformed keys are rejected; lastUsedAt is updated (debounced)', async () => {
    const buyerId = await buyerIdForAddress(ADDR);
    const { id, key } = await createApiKey(buyerId, 'v');
    expect(await verifyApiKey('sk-spdl-nope')).toBeNull();
    expect(await verifyApiKey('nope')).toBeNull();
    expect(await verifyApiKey(`${key}x`)).toBeNull();
    expect(await verifyApiKey(key)).toEqual({ keyId: id, buyerId });
    await new Promise((r) => setTimeout(r, 100));
    const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    expect(row?.lastUsedAt).not.toBeNull();
  });
});

describe('balance reservation', () => {
  test('reserve / settle / release', async () => {
    const buyerId = await buyerIdForAddress(ADDR);
    const { buyerBalances } = await import('../../db/schema');
    await t.db
      .update(buyerBalances)
      .set({ balanceUsdgMicros: 100n })
      .where(eq(buyerBalances.buyerId, buyerId));
    await reserve(buyerId, 60n);
    await expect(reserve(buyerId, 41n)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await reserve(buyerId, 40n);
    await release(buyerId, 40n);
    // charge never exceeds the reservation
    const charged = await settleCharge(buyerId, 60n, 75n, crypto.randomUUID());
    expect(charged).toBe(60n);
    const [b] = await t.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, buyerId));
    expect(b).toMatchObject({ balanceUsdgMicros: 40n, reservedUsdgMicros: 0n });
  });
});
