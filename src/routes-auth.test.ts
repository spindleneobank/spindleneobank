/**
 * Every signed-in and admin route, found from the app itself so a new route cannot be forgotten: no session gets 401
 * and a normal user cannot reach an admin route. Mutating routes must also refuse a stale admin session.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setupTestDb, type TestDb } from '../test/db-setup';
import { buildApp } from './app';
import { sessions } from './db/schema';
import { routeModules } from './lib/modules';
import { closeRedis } from './lib/redis';
import { dbRef, settings } from './modules/auth/constants';
import { createTestSession } from './modules/auth/testing';

const app = buildApp(routeModules);
const ID = '00000000-0000-0000-0000-000000000000';
const ADMIN = '0x00000000000000000000000000000000000000a1';
const USER = '0x00000000000000000000000000000000000000a2';
const ORIGIN = 'http://localhost:7000';
const routes = [
  ...new Set(
    app.routes
      .filter((r) => r.method !== 'ALL' && /^\/v1\/(app|admin)\//.test(r.path))
      .map((r) => `${r.method} ${r.path}`),
  ),
].map((r) => {
  const [method, path] = r.split(' ') as [string, string];
  return { method, path, url: path.replace(/:[^/]+/g, ID) };
});

let t: TestDb;
const saved = { adminAddresses: settings.adminAddresses, corsOrigins: settings.corsOrigins };
const send = (r: (typeof routes)[number], headers: Record<string, string>) =>
  app.request(r.url, {
    method: r.method,
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    ...(r.method === 'GET' ? {} : { body: '{}' }),
  });

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  Object.assign(settings, { adminAddresses: [ADMIN], corsOrigins: [ORIGIN] });
});
afterAll(async () => {
  Object.assign(settings, saved);
  await t.close();
  await closeRedis();
});

test('the sweep sees the routes it is meant to', () => {
  expect(routes.length).toBeGreaterThan(40);
  for (const p of [
    '/v1/app/earnings/series',
    '/v1/app/earnings/ledger',
    '/v1/admin/slash-cases',
    '/v1/app/receipts',
  ]) {
    expect(routes.some((r) => r.path.startsWith(p))).toBe(true);
  }
});

describe('no session', () => {
  for (const r of routes) {
    test(`${r.method} ${r.path}`, async () => {
      expect((await send(r, { 'x-spindle': '1' })).status).toBe(401);
    });
  }
});

describe('a user who is not an admin', () => {
  for (const r of routes.filter((x) => x.path.startsWith('/v1/admin/'))) {
    test(`${r.method} ${r.path}`, async () => {
      const { headers } = await createTestSession(USER);
      expect((await send(r, headers)).status).toBe(403);
    });
  }
});

describe('an admin whose signature is stale', () => {
  for (const r of routes.filter((x) => x.path.startsWith('/v1/admin/') && x.method !== 'GET')) {
    test(`${r.method} ${r.path}`, async () => {
      const { headers } = await createTestSession(ADMIN);
      await t.db.update(sessions).set({ freshUntil: new Date(Date.now() - 1000) });
      const res = await send(r, headers);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('REAUTH_REQUIRED');
    });
  }
});

/** Everything else that changes state: without credentials or with a body that makes no sense, it must refuse. */
describe('public routes refuse invalid input', () => {
  const publicRoutes = [
    ...new Set(
      app.routes
        .filter((r) => !['ALL', 'GET'].includes(r.method) && !/^\/v1\/(app|admin)\//.test(r.path))
        .map((r) => `${r.method} ${r.path}`),
    ),
  ].filter((r) => r !== 'POST /v1/auth/logout'); // logging out with no session is a harmless no-op

  test('the sweep sees them', () => {
    for (const r of [
      'POST /v1/x402/sessions',
      'POST /v1/x402/sessions/:id/open',
      'POST /v1/x402/sessions/:id/close',
    ]) {
      expect(publicRoutes).toContain(r);
    }
  });
  for (const r of publicRoutes) {
    const [method, path] = r.split(' ') as [string, string];
    test(r, async () => {
      const res = await app.request(path.replace(/:[^/]+/g, ID), {
        method,
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-spindle': '1' },
        body: '{"not":"valid"}',
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  }
});
