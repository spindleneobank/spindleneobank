import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import {
  auditLog,
  buyerLedger,
  buyers,
  cardOperations,
  cards,
  earningEvents,
  epochs,
  kv,
  models,
  nodes,
  rateCard,
  users,
  x402Payments,
} from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { epochSettings } from '../epochs/service';
import { floorSettings } from '../floor/service';
import { utcDay } from '../gateway/pricing';
import { addDays, ensureRateCard, rateCardFor, setRateCard } from '../rates/service';
import { computeKillMetrics, evaluateKill } from './metrics';
import { JOB_REGISTRY, runAdminJob } from './registry';
import { createAdminRoutes } from './routes';
import type { AdminDeps } from './service';

const ORIGIN = 'http://localhost:7000';
const ADMIN = '0x00000000000000000000000000000000000000a1';
const USER = '0x00000000000000000000000000000000000000b2';
const CLAIMS = '0x00000000000000000000000000000000000000c3';
const TREASURY = '0x00000000000000000000000000000000000000d4';
const KEEPER = '0x00000000000000000000000000000000000000e5';

let t: TestDb;
let refreshed = 0;
const balances: Record<string, bigint> = {};
const enqueued: { queue: string; name: string }[] = [];
const deps: AdminDeps = {
  usdgBalance: async (a) => balances[a.toLowerCase()] ?? 0n,
  totalClaimed: async () => 300_000n,
  keeper: async () => ({
    address: KEEPER,
    balanceWei: '5000000000000000',
    ethUsdMicros: null,
    gasPriceWei: '1',
    level: 'ok',
    checkedAt: new Date().toISOString(),
  }),
  queueCounts: async () => ({ epoch: { waiting: 1, active: 0, failed: 2, delayed: 3 } }),
  barredPayers: async () => ['0xbad'],
  refreshCatalog: async () => void refreshed++,
  addresses: () => ({ claims: CLAIMS, treasury: TREASURY }),
  now: () => new Date(),
};
const app = new Hono<Env>();
app.onError(jsonError);
authRoutes(app);
createAdminRoutes(deps, {
  enqueue: async (queue, name) => {
    enqueued.push({ queue, name });
    return { id: 'j1' };
  },
})(app);

// biome-ignore lint/suspicious/noExplicitAny: test helper over loosely typed JSON
const json = async (r: Response): Promise<any> => r.json();

const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  app.request(path, {
    method,
    headers: { ...headers, origin: ORIGIN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let adminH: Record<string, string>;
let userH: Record<string, string>;

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  Object.assign(settings, {
    corsOrigins: [ORIGIN],
    allowedDomains: ['localhost:7000'],
    adminAddresses: [ADMIN],
  });
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  refreshed = 0;
  enqueued.length = 0;
  adminH = (await createTestSession(ADMIN)).headers;
  userH = (await createTestSession(USER)).headers;
  Object.assign(balances, { [CLAIMS]: 1_000_000n, [TREASURY]: 9_000_000n, [KEEPER]: 42n });
});

const routes: [string, string, unknown?][] = [
  ['GET', '/v1/admin/overview'],
  ['GET', '/v1/admin/rate-card'],
  ['PUT', '/v1/admin/rate-card', { rows: [] }],
  ['GET', '/v1/admin/models'],
  ['PUT', '/v1/admin/models', { models: [] }],
  ['GET', '/v1/admin/floor'],
  ['POST', '/v1/admin/jobs/indexer/run'],
];

describe('auth', () => {
  for (const [m, p, b] of routes) {
    test(`${m} ${p}: 401 anonymous, 403 non-admin`, async () => {
      expect((await call(m, p, { 'x-spindle': '1' }, b)).status).toBe(401);
      expect((await call(m, p, userH, b)).status).toBe(403);
    });
  }
});

describe('rate card', () => {
  const rowsOf = (r: { rows: unknown[] }) => r.rows as { gpuClass: number; lane: string; unitKind: string }[];

  test("PUT replaces tomorrow's card, is audited, and never touches today's", async () => {
    const today = utcDay();
    const tomorrow = addDays(today, 1);
    await ensureRateCard(today);
    const todayBefore = await rateCardFor(today);
    const got = await json(await call('GET', '/v1/admin/rate-card', adminH));
    expect(got.day).toBe(tomorrow);
    expect(got.today.day).toBe(today);
    expect(got.today.frozen).toBe(true);
    const next = [
      {
        gpuClass: 1,
        lane: 'open',
        unitKind: 'tokens_1m',
        providerMicrosPerUnit: '80000',
        buyerMicrosPerUnit: '100000',
      },
      {
        gpuClass: 3,
        lane: 'sealed',
        unitKind: 'gpu_hour',
        providerMicrosPerUnit: '800000',
        buyerMicrosPerUnit: '1000000',
      },
    ];
    const res = await call('PUT', '/v1/admin/rate-card', adminH, { rows: next });
    expect(res.status).toBe(200);
    expect(rowsOf(await json(res))).toHaveLength(2);
    expect(await rateCardFor(tomorrow)).toHaveLength(2);
    expect(await rateCardFor(today)).toEqual(todayBefore);
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'admin.rate_card.put'));
    expect(a).toMatchObject({ actor: ADMIN, subject: tomorrow });
  });

  test("today's card cannot be edited (service guard), and bad rows are rejected", async () => {
    const today = utcDay();
    await ensureRateCard(today);
    await expect(setRateCard(today, [])).rejects.toThrow(/frozen/);
    const bad = await call('PUT', '/v1/admin/rate-card', adminH, {
      rows: [
        {
          gpuClass: 1,
          lane: 'open',
          unitKind: 'tokens_1m',
          providerMicrosPerUnit: '90',
          buyerMicrosPerUnit: '10',
        },
      ],
    });
    expect(bad.status).toBe(400);
    const dup = await call('PUT', '/v1/admin/rate-card', adminH, {
      rows: Array(2).fill({
        gpuClass: 1,
        lane: 'open',
        unitKind: 'tokens_1m',
        providerMicrosPerUnit: '1',
        buyerMicrosPerUnit: '2',
      }),
    });
    expect(dup.status).toBe(400);
    expect(await t.db.select().from(auditLog)).toHaveLength(0);
    expect((await t.db.select().from(rateCard).where(eq(rateCard.day, today))).length).toBeGreaterThan(0);
  });
});

describe('models', () => {
  test('GET shows the default catalog; PUT seeds, toggles, audits and refreshes the hub', async () => {
    const list = await json(await call('GET', '/v1/admin/models', adminH));
    expect(list.length).toBeGreaterThan(1);
    expect(list.every((m: { enabled: boolean }) => m.enabled)).toBe(true);
    const id = list[0].id;
    const res = await call('PUT', '/v1/admin/models', adminH, { models: [{ id, enabled: false }] });
    expect(res.status).toBe(200);
    expect((await json(res)).find((m: { id: string }) => m.id === id).enabled).toBe(false);
    expect((await t.db.select().from(models).where(eq(models.id, id)))[0]?.enabled).toBe(false);
    expect(refreshed).toBe(1);
    expect((await t.db.select().from(auditLog))[0]?.action).toBe('admin.models.put');
  });
  test('rejects unknown ids and disabling every model', async () => {
    expect(
      (await call('PUT', '/v1/admin/models', adminH, { models: [{ id: 'nope', enabled: true }] })).status,
    ).toBe(400);
    const list = await json(await call('GET', '/v1/admin/models', adminH));
    const all = list.map((m: { id: string }) => ({ id: m.id, enabled: false }));
    expect((await call('PUT', '/v1/admin/models', adminH, { models: all })).status).toBe(400);
    expect(refreshed).toBe(0);
  });
});

const seedNode = async (o: Partial<typeof nodes.$inferInsert>) => {
  const addr = `0x${Math.floor(Math.random() * 1e15)
    .toString(16)
    .padStart(40, '0')}`;
  const [u] = await t.db.insert(users).values({ address: addr }).returning();
  await t.db.insert(nodes).values({
    owner: addr,
    userId: u?.id as string,
    nodeKey: addr,
    nodePubkey: 'pk',
    name: 'n',
    engine: 'ollama',
    gpuClass: 1,
    lane: 'open',
    status: 'online',
    ...o,
  });
};

describe('metrics', () => {
  test('live/sealed nodes, spend, floor share against seeded data', async () => {
    const now = new Date();
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
    await seedNode({ lastSeenAt: ago(1) });
    await seedNode({ lastSeenAt: ago(2), lane: 'sealed' });
    await seedNode({ lastSeenAt: ago(30) }); // stale
    await seedNode({ lastSeenAt: ago(1), isHouse: true }); // house excluded
    await seedNode({ lastSeenAt: ago(1), status: 'suspended' });
    const [u] = await t.db
      .insert(users)
      .values({ address: USER })
      .onConflictDoUpdate({ target: users.address, set: { address: USER } })
      .returning();
    const [b] = await t.db.insert(buyers).values({ userId: u?.id, address: USER }).returning();
    await t.db.insert(buyerLedger).values([
      { buyerId: b?.id as string, kind: 'charge', usdgMicros: -3_000_000n },
      { buyerId: b?.id as string, kind: 'refund', usdgMicros: 500_000n },
      { buyerId: b?.id as string, kind: 'deposit', usdgMicros: 99_000_000n },
      {
        buyerId: b?.id as string,
        kind: 'charge',
        usdgMicros: -7_000_000n,
        createdAt: new Date(now.getTime() - 40 * 86_400_000),
      },
    ]);
    await t.db.insert(x402Payments).values([
      {
        paymentId: 'p1',
        payer: USER,
        scheme: 'exact',
        usedMicros: 1_500_000n,
        status: 'settled',
        closedAt: ago(5),
      },
      { paymentId: 'p2', payer: USER, scheme: 'exact', usedMicros: 9_000_000n, status: 'failed' },
    ]);
    const nid = crypto.randomUUID();
    await t.db.insert(earningEvents).values([
      { ts: ago(3), nodeId: nid, owner: USER, kind: 'job', usdgMicros: 900_000n },
      { ts: ago(3), nodeId: nid, owner: USER, kind: 'floor', usdgMicros: 100_000n },
      { ts: ago(3), nodeId: nid, owner: USER, kind: 'slash', usdgMicros: -50_000n },
    ]);
    const m = await computeKillMetrics(now);
    expect(m).toMatchObject({
      liveNodes: 2,
      sealedNodes: 1,
      buyerSpend30dMicros: 4_000_000n,
      floorShareBps: 1000,
    });
    expect(m.cardStockShareBps).toBeNull();
  });

  test('kill criteria thresholds from the Overview', () => {
    const m = {
      liveNodes: 150,
      sealedNodes: 24,
      buyerSpend30dMicros: 15_000_000_000n,
      cardStockShareBps: null,
      cardStockNote: '',
      floorShareBps: 2000,
      providerPayouts30dMicros: 0n,
      floorPayouts30dMicros: 0n,
    };
    const now = new Date('2026-03-01T00:00:00Z');
    const by = Object.fromEntries(evaluateKill(m, now, '2025-12-31').map((c) => [c.id, c]));
    expect(by['live-nodes']).toMatchObject({ met: true, due: true });
    expect(by['sealed-nodes']?.met).toBe(false);
    expect(by['buyer-spend-30d']?.met).toBe(true);
    expect(by['card-stock-share']?.met).toBeNull();
    expect(by['floor-share']).toMatchObject({ met: false, due: true });
    expect(evaluateKill(m, now, '2026-02-25').every((c) => !c.due)).toBe(true);
  });
});

describe('overview', () => {
  test('balances, solvency top-up, queues, epoch, alerts, x402, card review', async () => {
    Object.assign(floorSettings, { startDate: utcDay() });
    await t.db.insert(epochs).values({
      epoch: 7n,
      root: `0x${'1'.repeat(64)}`,
      totalEarnedUsdgMicros: 1_000_000n,
      owners: 1,
      treePath: '7.json',
      status: 'posted',
    });
    // 600_000 of unposted earnings (incl. floor): owed = 1_000_000 + 600_000 - 300_000 claimed = 1_300_000 vs pool 1_000_000
    await t.db.insert(earningEvents).values({
      ts: new Date(),
      nodeId: crypto.randomUUID(),
      owner: USER,
      kind: 'floor',
      usdgMicros: 600_000n,
    });
    await t.db.insert(kv).values({ key: 'epoch:alert', value: { reason: 'x' } });
    const [u] = await t.db
      .insert(users)
      .values({ address: USER })
      .onConflictDoUpdate({ target: users.address, set: { address: USER } })
      .returning();
    const [c] = await t.db
      .insert(cards)
      .values({ userId: u?.id as string, product: 'p', status: 'issued' } as never)
      .returning()
      .catch(() => []);
    if (c)
      await t.db
        .insert(cardOperations)
        .values({ cardId: c.id, userId: u?.id as string, kind: 'topup', status: 'review' });

    const res = await call('GET', '/v1/admin/overview', adminH);
    expect(res.status).toBe(200);
    const o = await json(res);
    expect(o.errors).toEqual([]);
    expect(o.balances).toEqual({
      treasuryUsdgMicros: '9000000',
      keeperEthWei: '5000000000000000',
      keeperUsdgMicros: '42',
      claimsPoolUsdgMicros: '1000000',
      claimsOwedMicros: '700000',
    });
    expect(o.solvency).toMatchObject({
      owedIncludingPendingMicros: '1300000',
      headroomMicros: '-300000',
      topUpNeededMicros: '300000',
      treasuryCanCover: true,
      ok: false,
    });
    expect(o.queues.epoch).toMatchObject({ waiting: 1, failed: 2 });
    expect(o.lastEpoch).toBe(7);
    expect(o.alerts.epoch).toEqual({ reason: 'x' });
    expect(o.x402.barredPayers).toEqual(['0xbad']);
    expect(o.killMetrics.cardStockShareBps).toBeNull();
    expect(o.killCriteria).toHaveLength(5);
    expect(o.floor.decayBps).toBe(10_000);
    expect(o.cards.reviewOperations).toBe(c ? 1 : 0);
  });

  test('a failing chain read degrades to null + errors, not a 500', async () => {
    const failing = new Hono<Env>();
    failing.onError(jsonError);
    authRoutes(failing);
    createAdminRoutes({ ...deps, keeper: async () => Promise.reject(new Error('rpc down')) })(failing);
    const res = await failing.request('/v1/admin/overview', { headers: { ...adminH, origin: ORIGIN } });
    expect(res.status).toBe(200);
    const o = await json(res);
    expect(o.balances.keeperEthWei).toBeNull();
    expect(o.errors.join()).toContain('rpc down');
  });
});

describe('floor + jobs', () => {
  test('GET floor reports budget, decay and per-epoch payments', async () => {
    Object.assign(floorSettings, { startDate: utcDay(), epochBudgetMicros: 2_000_000n });
    const r = await (await call('GET', '/v1/admin/floor', adminH)).json();
    expect(r).toMatchObject({ enabled: true, decayBps: 10_000, budgetMicros: '2000000', perEpoch: [] });
  });

  test('jobs: registry covers the contract names; queue jobs enqueue on the right queue; unknown 404; audited', async () => {
    for (const n of [
      'epoch-build',
      'post-root',
      'x402-settle',
      'indexer',
      'canary-dispatch',
      'probe-dispatch',
      'cards-reconcile',
    ])
      expect(JOB_REGISTRY[n]).toBeDefined();
    const res = await call('POST', '/v1/admin/jobs/probe-dispatch/run', adminH);
    expect(await res.json()).toMatchObject({ queued: true, mode: 'queue', queue: 'probes', jobId: 'j1' });
    await call('POST', '/v1/admin/jobs/cards-reconcile/run', adminH);
    expect(enqueued).toEqual([
      { queue: 'probes', name: 'probe-dispatch' },
      { queue: 'cards', name: 'cards:reconcile' },
    ]);
    expect((await call('POST', '/v1/admin/jobs/nope/run', adminH)).status).toBe(404);
    expect((await call('POST', '/v1/admin/jobs/constructor/run', adminH)).status).toBe(404);
    expect((await t.db.select().from(auditLog)).filter((a) => a.action === 'admin.job.run')).toHaveLength(2);
  });

  test('inline job runs in-process and returns a JSON-safe result', async () => {
    epochSettings.epochSeconds = 3600;
    const r = await runAdminJob('floor-apply', ADMIN, { enqueue: async () => ({}) });
    expect(r).toMatchObject({ queued: true, mode: 'inline' });
  });
});
