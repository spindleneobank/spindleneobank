import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { ensureBuyer } from '../../db/balances';
import { buyerBalances, epochs, jobs, nodes, users } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import epochRoutes from '../epochs/routes';
import networkRoutes, { NETWORK_STATS_KEY } from '../network/routes';
import meRoutes from './routes';

const ORIGIN = 'http://localhost:7000';
let t: TestDb;
const ADDR = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const app = new Hono<Env>();
app.onError(jsonError);
authRoutes(app);
meRoutes(app);
networkRoutes(app);
epochRoutes(app);

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  settings.adminAddresses = [];
  settings.corsOrigins = [ORIGIN];
  await getRedis().del(NETWORK_STATS_KEY);
});

const patch = (headers: Record<string, string>, body: unknown) =>
  app.request('/v1/app/me', {
    method: 'PATCH',
    headers: { ...headers, origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/v1/app/me', () => {
  test('401 without session', async () => {
    expect((await app.request('/v1/app/me')).status).toBe(401);
  });

  test('profile, admin flag, buyer', async () => {
    const s = await createTestSession(ADDR);
    let r = await app.request('/v1/app/me', { headers: s.headers });
    expect(await r.json()).toEqual({ address: ADDR, prefs: {}, isAdmin: false, buyer: null });
    const id = await ensureBuyer(t.db, ADDR);
    await t.db.update(buyerBalances).set({ balanceUsdgMicros: 5_000_000n });
    settings.adminAddresses = [ADDR];
    r = await app.request('/v1/app/me', { headers: s.headers });
    expect(await r.json()).toEqual({
      address: ADDR,
      prefs: {},
      isAdmin: true,
      buyer: { id, balanceMicros: '5000000' },
    });
  });

  test('PATCH merges prefs and rejects unknown keys', async () => {
    const s = await createTestSession(ADDR);
    let r = await patch(s.headers, { prefs: { afterClaim: 'card', notifications: true } });
    expect(r.status).toBe(200);
    r = await patch(s.headers, { prefs: { cardFinish: 'matte' } });
    expect(await r.json()).toEqual({
      prefs: { afterClaim: 'card', notifications: true, cardFinish: 'matte' },
    });
    expect((await patch(s.headers, { prefs: { evil: 1 } })).status).toBe(400);
    expect((await patch(s.headers, { prefs: { afterClaim: 'nope' } })).status).toBe(400);
    expect((await patch(s.headers, { prefs: {}, extra: 1 })).status).toBe(400);
    const [u] = await t.db.select().from(users);
    expect(u?.prefs).toEqual({ afterClaim: 'card', notifications: true, cardFinish: 'matte' });
  });
});

describe('/v1/network/stats', () => {
  test('counts, 24h window, and 30 s cache', async () => {
    const [u] = await t.db.insert(users).values({ address: ADDR }).returning();
    const mk = (status: string, lane: string, registered = true) => ({
      owner: ADDR,
      userId: u?.id as string,
      nodeKey: privateKeyToAccount(generatePrivateKey()).address.toLowerCase(),
      nodePubkey: '0x04',
      name: 'n',
      engine: 'ollama',
      gpuClass: 1,
      lane,
      status,
      registered,
    });
    await t.db
      .insert(nodes)
      .values([
        mk('online', 'open'),
        mk('busy', 'sealed'),
        mk('offline', 'open'),
        mk('online', 'open', false),
      ]);
    const buyerId = await ensureBuyer(t.db, ADDR);
    const job = (status: string, p: number, c: number, finishedAt: Date) => ({
      buyerId,
      model: 'm',
      kind: 'chat',
      unitKind: 'tokens_1m',
      payMode: 'balance',
      status,
      promptTokens: p,
      completionTokens: c,
      finishedAt,
    });
    const now = new Date();
    const old = new Date(now.getTime() - 25 * 3600 * 1000);
    await t.db
      .insert(jobs)
      .values([job('completed', 10, 5, now), job('completed', 1, 1, old), job('failed', 100, 100, now)]);
    await t.db.insert(epochs).values({
      epoch: 7n,
      root: `0x${'1'.repeat(64)}`,
      totalEarnedUsdgMicros: 1n,
      owners: 1,
      treePath: '7.json',
      status: 'posted',
      postedAt: now,
    });
    const body = {
      nodesOnline: 2,
      nodesByLane: { sealed: 1, open: 1 },
      jobs24h: 1,
      tokens24h: 15,
      latestEpoch: 7,
    };
    const r = await app.request('/v1/network/stats');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(body);
    await t.db.delete(jobs);
    expect(await (await app.request('/v1/network/stats')).json()).toEqual(body);
    expect(await getRedis().ttl(NETWORK_STATS_KEY)).toBeGreaterThan(0);
  });
});

describe('GET /v1/epochs', () => {
  test('newest first, cursor pagination', async () => {
    const postedAt = new Date('2026-03-10T10:00:00Z');
    await t.db.insert(epochs).values(
      [1n, 2n, 3n].map((epoch) => ({
        epoch,
        root: `0x${'2'.repeat(64)}`,
        totalEarnedUsdgMicros: 100n * epoch,
        owners: Number(epoch),
        treePath: `${epoch}.json`,
        status: epoch === 3n ? 'built' : 'posted',
        postedAt: epoch === 3n ? null : postedAt,
        txHash: epoch === 3n ? null : `0x${'a'.repeat(64)}`,
      })),
    );
    const p1 = (await (await app.request('/v1/epochs?limit=2')).json()) as {
      items: { epoch: number; status: string; claimableAt: string | null; totalEarned: string }[];
      nextCursor: string | null;
    };
    expect(p1.items.map((i) => i.epoch)).toEqual([3, 2]);
    expect(p1.items[0]?.claimableAt).toBeNull();
    expect(p1.items[0]?.status).toBe('built');
    expect(p1.items[1]?.claimableAt).not.toBeNull();
    expect(p1.items[1]?.totalEarned).toBe('200');
    expect(p1.nextCursor).toBe('2');
    const p2 = (await (await app.request(`/v1/epochs?limit=2&cursor=${p1.nextCursor}`)).json()) as {
      items: { epoch: number }[];
      nextCursor: string | null;
    };
    expect(p2.items.map((i) => i.epoch)).toEqual([1]);
    expect(p2.nextCursor).toBeNull();
    expect((await app.request('/v1/epochs?cursor=abc')).status).toBe(400);
  });
});
