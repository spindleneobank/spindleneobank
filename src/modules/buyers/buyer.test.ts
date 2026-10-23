import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { buyerBalances, buyerLedger, jobs } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { defaultStateDeps } from '../x402/guard';
import { createBuyerRoutes } from './routes';
import { buyerIdForAddress } from './service';

const VAULT = '0x00000000000000000000000000000000000000aa';
const USDG = '0x00000000000000000000000000000000000000bb';
let allowance = 0n;
let t: TestDb;
let app: Hono<Env>;
const ADDR = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const ORIGIN = 'http://localhost:7300';

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  settings.corsOrigins.push(ORIGIN);
  Object.assign(defaultStateDeps, { enabledInConfig: () => false });
  app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  createBuyerRoutes({ vault: () => VAULT, usdg: () => USDG, allowance: async () => allowance })(app);
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(() => t.reset());

describe('GET /v1/app/buyer', () => {
  test('401 without a session', async () => {
    expect((await app.request('/v1/app/buyer')).status).toBe(401);
  });

  test('returns address, balances and the x402 status', async () => {
    const s = await createTestSession(ADDR);
    const id = await buyerIdForAddress(ADDR);
    await t.db.update(buyerBalances).set({ balanceUsdgMicros: 5_000_000n, reservedUsdgMicros: 250_000n });
    expect(id).toBeTruthy();
    const res = await app.request('/v1/app/buyer', { headers: s.headers });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      address: string;
      balanceMicros: string;
      reservedMicros: string;
      x402: Record<string, unknown>;
    };
    expect(j.address).toBe(ADDR);
    expect(j.balanceMicros).toBe('5000000');
    expect(j.reservedMicros).toBe('250000');
    expect(j.x402.enabled).toBe(false);
    expect(j.x402.minSurchargeMicros).toBe('5000');
    expect(typeof j.x402.currentSurchargeMicros).toBe('string');
  });
});

describe('ledger, usage, deposit-call', () => {
  test('ledger paginates newest first', async () => {
    const s = await createTestSession(ADDR);
    const buyerId = await buyerIdForAddress(ADDR);
    for (let i = 0; i < 3; i++)
      await t.db.insert(buyerLedger).values({
        buyerId,
        kind: 'deposit',
        usdgMicros: BigInt(i + 1),
        txHash: `0x${String(i).repeat(64)}`,
        logIndex: i,
        createdAt: new Date(Date.now() - i * 1000),
      });
    const r1 = (await (await app.request('/v1/app/buyer/ledger?limit=2', { headers: s.headers })).json()) as {
      items: { micros: string }[];
      nextCursor: string | null;
    };
    expect(r1.items.map((x) => x.micros)).toEqual(['1', '2']);
    const r2 = (await (
      await app.request(`/v1/app/buyer/ledger?limit=2&cursor=${r1.nextCursor}`, { headers: s.headers })
    ).json()) as { items: { micros: string }[]; nextCursor: string | null };
    expect(r2.items.map((x) => x.micros)).toEqual(['3']);
    expect(r2.nextCursor).toBeNull();
    expect((await app.request('/v1/app/buyer/ledger')).status).toBe(401);
  });

  test('usage groups by model and day within the range', async () => {
    const s = await createTestSession(ADDR);
    const buyerId = await buyerIdForAddress(ADDR);
    const base = { buyerId, kind: 'chat', unitKind: 'tokens_1m', payMode: 'balance', status: 'completed' };
    await t.db.insert(jobs).values([
      { ...base, model: 'm1', lane: 'open', units: '10', buyerUsdgMicros: 100n },
      { ...base, model: 'm1', lane: 'open', units: '5', buyerUsdgMicros: 50n },
      { ...base, model: 'm2', lane: 'sealed', units: '1', buyerUsdgMicros: 500n },
      {
        ...base,
        model: 'old',
        lane: 'open',
        units: '1',
        buyerUsdgMicros: 9n,
        createdAt: new Date(Date.now() - 20 * 86_400_000),
      },
    ]);
    const u = (await (await app.request('/v1/app/buyer/usage?range=7d', { headers: s.headers })).json()) as {
      byModel: { model: string; jobs: number; units: string; spentMicros: string }[];
      series: { ts: string; spentMicros: string }[];
    };
    expect(u.byModel.map((x) => [x.model, x.jobs, x.units, x.spentMicros])).toEqual([
      ['m2', 1, '1', '500'],
      ['m1', 2, '15', '150'],
    ]);
    expect(u.series).toHaveLength(1);
    expect(u.series[0]?.spentMicros).toBe('650');
    const u30 = (await (await app.request('/v1/app/buyer/usage', { headers: s.headers })).json()) as {
      byModel: unknown[];
    };
    expect(u30.byModel).toHaveLength(3);
    expect((await app.request('/v1/app/buyer/usage?range=1y', { headers: s.headers })).status).toBe(400);
  });

  test('deposit-call includes approve only when allowance is short', async () => {
    const s = await createTestSession(ADDR);
    allowance = 0n;
    const a = (await (
      await app.request('/v1/app/buyer/deposit-call?amountMicros=5000000', { headers: s.headers })
    ).json()) as Record<string, { to: string; functionName: string; args: string[] }>;
    expect(a.approve).toEqual({ to: USDG, functionName: 'approve', args: [VAULT, '5000000'] });
    expect(a.deposit).toEqual({ to: VAULT, functionName: 'deposit', args: ['5000000'] });
    allowance = 5_000_000n;
    const b = (await (
      await app.request('/v1/app/buyer/deposit-call?amountMicros=5000000', { headers: s.headers })
    ).json()) as Record<string, unknown>;
    expect(b.approve).toBeUndefined();
    expect(b.deposit).toBeTruthy();
    expect(
      (await app.request('/v1/app/buyer/deposit-call?amountMicros=0', { headers: s.headers })).status,
    ).toBe(400);
    expect((await app.request('/v1/app/buyer/deposit-call', { headers: s.headers })).status).toBe(400);
  });
});
