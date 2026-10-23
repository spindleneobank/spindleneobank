import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { buyerBalances } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { defaultStateDeps } from '../x402/guard';
import buyerRoutes from './routes';
import { buyerIdForAddress } from './service';

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
  buyerRoutes(app);
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
