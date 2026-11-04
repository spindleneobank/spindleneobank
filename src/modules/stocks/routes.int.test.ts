// Host-run: needs the dev stack (postgres 7232, redis 7279) and the anvil fork:
//   RPC_URLS=http://127.0.0.1:7245 bun run test:int -- src/modules/stocks
// (backend.env.dev points RPC_URLS/TEST_DATABASE_URL at docker hostnames; env vars set in the shell win.)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { decodeFunctionData } from 'viem';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { FORK_SKIP_MESSAGE, forkHealthy } from '../../../test/fork';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { swapRouter02Abi } from './abi';
import stocksRoutes from './routes';
import { DEFAULT_STOCKS, stockDb, upsertVerified } from './service';

const healthy = await forkHealthy();
if (!healthy) console.warn(`[skip] ${import.meta.file}: ${FORK_SKIP_MESSAGE}`);

const ORIGIN = 'http://localhost:7000';
const USER = '0x00000000000000000000000000000000000000a1';
const NVDA = DEFAULT_STOCKS[0]?.address as string;
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';

let t: TestDb;
const app = new Hono<Env>();
app.onError(jsonError);
authRoutes(app);
stocksRoutes(app);

beforeAll(async () => {
  if (!healthy) return;
  t = await setupTestDb();
  await t.reset();
  dbRef.db = t.db;
  stockDb.db = t.db;
  Object.assign(settings, { corsOrigins: [ORIGIN], allowedDomains: ['localhost:7000'], adminAddresses: [] });
  const v = await upsertVerified(NVDA, true);
  expect(v.ok).toBe(true);
}, 60_000);

afterAll(async () => {
  if (!healthy) return;
  await t.close();
  await closeRedis();
});

const post = (path: string, headers: Record<string, string>, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { ...headers, origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe.skipIf(!healthy)('stocks routes', () => {
  test('401 without a session', async () => {
    expect((await app.request('/v1/app/stocks')).status).toBe(401);
  });

  test('GET list returns enabled curated tokens', async () => {
    const s = await createTestSession(USER);
    const res = await app.request('/v1/app/stocks', { headers: s.headers });
    expect(res.status).toBe(200);
    const list = (await res.json()) as { address: string; symbol: string; poolFee: number }[];
    expect(list.map((x) => x.symbol)).toContain('NVDA');
    expect(list.find((x) => x.symbol === 'NVDA')?.poolFee).toBeGreaterThan(0);
  });

  test('POST quote happy path against the fork', async () => {
    const s = await createTestSession(USER);
    const res = await post('/v1/app/stocks/quote', s.headers, { token: NVDA, amountInMicros: '20000000' });
    expect(res.status).toBe(200);
    const q = (await res.json()) as {
      amountOut: string;
      feeBps: number;
      swap: { args: [string, `0x${string}`[]] };
      expiresAt: string;
    };
    expect(BigInt(q.amountOut)).toBeGreaterThan(0n);
    expect(q.feeBps).toBeGreaterThan(0);
    const inner = decodeFunctionData({ abi: swapRouter02Abi, data: q.swap.args[1][0] as `0x${string}` });
    expect((inner.args?.[0] as { recipient: string }).recipient.toLowerCase()).toBe(USER);
  }, 30_000);

  test('non-curated token is a 400', async () => {
    const s = await createTestSession(USER);
    const res = await post('/v1/app/stocks/quote', s.headers, { token: USDG, amountInMicros: '1000000' });
    expect(res.status).toBe(400);
  });

  test('admin PUT is forbidden for a non-admin', async () => {
    const s = await createTestSession(USER);
    const res = await app.request('/v1/admin/stock-tokens', {
      method: 'PUT',
      headers: { ...s.headers, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ address: NVDA, enabled: true }),
    });
    expect(res.status).toBe(403);
  });

  test('admin PUT verifies and upserts for an admin', async () => {
    const admin = '0x00000000000000000000000000000000000000ad';
    settings.adminAddresses = [admin];
    const s = await createTestSession(admin);
    const res = await app.request('/v1/admin/stock-tokens', {
      method: 'PUT',
      headers: { ...s.headers, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ address: NVDA, enabled: true }),
    });
    expect(res.status).toBe(200);
    settings.adminAddresses = [];
  });
});
