import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { type Hex, recoverMessageAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage, parseSiweMessage } from 'viem/siwe';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { sessions, users } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef, LOGIN_STATEMENT, REAUTH_STATEMENT, SESSION_COOKIE, settings } from './constants';
import { csrf, requireAdmin, requireFreshAuth, requireSession } from './middleware';
import authRoutes from './routes';
import { sha256Hex, siweDeps } from './service';
import { createTestSession } from './testing';

const ORIGIN = 'http://localhost:7000';
const account = privateKeyToAccount(generatePrivateKey());
let t: TestDb;

const app = new Hono<Env>();
app.onError(jsonError);
authRoutes(app);
app.get('/v1/app/fresh', requireSession, requireFreshAuth, (c) => c.json({ ok: true }));
app.get('/v1/admin/ping', requireAdmin, (c) => c.json({ ok: true }));
app.post('/v1/app/mutate', (c) => c.json({ ok: true }));
app.post('/v1/webhooks/x', (c) => c.json({ ok: true }));
app.post('/v1/chat/completions', (c) => c.json({ ok: true }));

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  Object.assign(settings, {
    corsOrigins: [ORIGIN],
    allowedDomains: ['localhost:7000'],
    chainId: 4663,
    adminAddresses: [],
  });
  // Local ecrecover instead of an RPC call; the live path uses viem's verifySiweMessage.
  siweDeps.verifySignature = async (message, signature) => {
    const parsed = parseSiweMessage(message);
    try {
      return (
        (await recoverMessageAddress({ message, signature })).toLowerCase() === parsed.address?.toLowerCase()
      );
    } catch {
      return false;
    }
  };
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(() => t.reset());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-spindle': '1',
      'cf-connecting-ip': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });

async function nonce(): Promise<string> {
  const res = await app.request('/v1/auth/nonce', {
    headers: {
      'cf-connecting-ip': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
  });
  return ((await res.json()) as { nonce: string }).nonce;
}

async function signed(
  over: Partial<Parameters<typeof createSiweMessage>[0]> = {},
  statement = LOGIN_STATEMENT,
) {
  const message = createSiweMessage({
    address: account.address,
    chainId: 4663,
    domain: 'localhost:7000',
    nonce: await nonce(),
    uri: ORIGIN,
    version: '1',
    statement,
    issuedAt: new Date(),
    ...over,
  });
  return { message, signature: await account.signMessage({ message }) };
}

describe('nonce', () => {
  test('nonce is single use', async () => {
    const n = await nonce();
    expect(n).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(await getRedis().ttl(`siwe:nonce:${n}`)).toBeGreaterThan(0);
    const message = createSiweMessage({
      address: account.address,
      chainId: 4663,
      domain: 'localhost:7000',
      nonce: n,
      uri: ORIGIN,
      version: '1',
      statement: LOGIN_STATEMENT,
      issuedAt: new Date(),
    });
    const body = { message, signature: await account.signMessage({ message }) };
    expect((await post('/v1/auth/verify', body)).status).toBe(200);
    expect((await post('/v1/auth/verify', body)).status).toBe(401);
  });

  test('nonce is consumed even when the signature is bad', async () => {
    const s = await signed();
    const other = privateKeyToAccount(generatePrivateKey());
    const bad = await other.signMessage({ message: s.message });
    expect((await post('/v1/auth/verify', { message: s.message, signature: bad })).status).toBe(401);
    expect((await post('/v1/auth/verify', s)).status).toBe(401);
  });
});

describe('verify', () => {
  test('rejects wrong domain / chainId / stale issuedAt / wrong statement / bad signature', async () => {
    const cases: Array<Awaited<ReturnType<typeof signed>>> = [
      await signed({ domain: 'evil.com' }),
      await signed({ chainId: 1 }),
      await signed({ issuedAt: new Date(Date.now() - 11 * 60_000) }),
      await signed({ issuedAt: new Date(Date.now() + 5 * 60_000) }),
      await signed({}, 'Send me money.'),
      await signed({ uri: 'https://evil.com' }),
    ];
    const s = await signed();
    cases.push({ message: s.message, signature: `0x${'11'.repeat(65)}` as Hex });
    for (const c of cases) expect((await post('/v1/auth/verify', c)).status).toBe(401);
    expect(await t.db.select().from(sessions)).toHaveLength(0);
  });

  test('happy path sets cookie and session row (hash only)', async () => {
    const res = await post('/v1/auth/verify', await signed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { address: string; expiresAt: string };
    expect(body.address).toBe(account.address.toLowerCase());
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=2592000');
    expect(setCookie).not.toContain('Domain');
    const token = /spindle_session=([^;]+)/.exec(setCookie)?.[1] ?? '';
    const rows = await t.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256Hex(token));
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(rows[0]?.freshUntil && rows[0].freshUntil.getTime() > Date.now()).toBe(true);
    const sess = await app.request('/v1/auth/session', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(await sess.json()).toEqual({ address: account.address.toLowerCase(), chainId: 4663, fresh: true });
  });

  test('cookie domain and secure come from settings', async () => {
    Object.assign(settings, { cookieDomain: '.example.com', cookieSecure: true });
    try {
      const res = await post('/v1/auth/verify', await signed());
      const c = res.headers.get('set-cookie') ?? '';
      expect(c).toContain('Domain=.example.com');
      expect(c).toContain('Secure');
    } finally {
      Object.assign(settings, { cookieDomain: '', cookieSecure: false });
    }
  });

  test('logout deletes the row and clears the cookie', async () => {
    const s = await createTestSession(account.address);
    const res = await post('/v1/auth/logout', {}, { cookie: s.cookie });
    expect(res.status).toBe(204);
    expect(await t.db.select().from(sessions)).toHaveLength(0);
    expect((await app.request('/v1/auth/session', { headers: { cookie: s.cookie } })).status).toBe(401);
  });
});

describe('reauth / fresh auth', () => {
  test('reauth extends fresh_until; requireFreshAuth 403 after expiry', async () => {
    const s = await createTestSession(account.address);
    const get = () => app.request('/v1/app/fresh', { headers: { cookie: s.cookie } });
    expect((await get()).status).toBe(200);
    await t.db.update(sessions).set({ freshUntil: new Date(Date.now() - 1000) });
    const denied = await get();
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('REAUTH_REQUIRED');

    const wrongStatement = await signed({}, LOGIN_STATEMENT);
    expect((await post('/v1/auth/reauth', wrongStatement, { cookie: s.cookie })).status).toBe(401);
    const stranger = privateKeyToAccount(generatePrivateKey());
    const m = createSiweMessage({
      address: stranger.address,
      chainId: 4663,
      domain: 'localhost:7000',
      nonce: await nonce(),
      uri: ORIGIN,
      version: '1',
      statement: REAUTH_STATEMENT,
      issuedAt: new Date(),
    });
    expect(
      (
        await post(
          '/v1/auth/reauth',
          { message: m, signature: await stranger.signMessage({ message: m }) },
          { cookie: s.cookie },
        )
      ).status,
    ).toBe(401);

    const ok = await post('/v1/auth/reauth', await signed({}, REAUTH_STATEMENT), { cookie: s.cookie });
    expect(ok.status).toBe(200);
    expect(Date.parse(((await ok.json()) as { freshUntil: string }).freshUntil)).toBeGreaterThan(Date.now());
    expect((await get()).status).toBe(200);
  });

  test('unauthenticated requests get 401', async () => {
    expect((await app.request('/v1/app/fresh')).status).toBe(401);
  });

  test('sliding renewal extends expires_at and re-sets the cookie', async () => {
    const s = await createTestSession(account.address);
    await t.db.update(sessions).set({ expiresAt: new Date(Date.now() + 2 * 86_400_000) });
    const res = await app.request('/v1/auth/session', { headers: { cookie: s.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(s.token);
    const [row] = await t.db.select().from(sessions);
    expect((row?.expiresAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });
});

describe('csrf', () => {
  test('rejects missing header and foreign Origin; webhooks and buyer routes exempt', async () => {
    const s = await createTestSession(account.address);
    const raw = (path: string, headers: Record<string, string>) =>
      app.request(path, { method: 'POST', headers: { cookie: s.cookie, ...headers } });
    expect((await raw('/v1/app/mutate', { origin: ORIGIN })).status).toBe(403);
    expect((await raw('/v1/app/mutate', { 'x-spindle': '1' })).status).toBe(403);
    expect((await raw('/v1/app/mutate', { 'x-spindle': '1', origin: 'https://evil.com' })).status).toBe(403);
    expect((await raw('/v1/app/mutate', { 'x-spindle': '1', origin: ORIGIN })).status).toBe(200);
    expect((await raw('/v1/webhooks/x', {})).status).toBe(200);
    expect((await raw('/v1/chat/completions', {})).status).toBe(200);
    expect(((await (await raw('/v1/app/mutate', {})).json()) as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN',
    );
  });

  test('standalone csrf middleware lets GET through', async () => {
    const a = new Hono<Env>();
    a.use('*', csrf);
    a.get('/x', (c) => c.text('ok'));
    expect((await a.request('/x')).status).toBe(200);
  });
});

describe('requireAdmin', () => {
  test('allow/deny', async () => {
    const s = await createTestSession(account.address);
    const get = () => app.request('/v1/admin/ping', { headers: { cookie: s.cookie } });
    expect((await app.request('/v1/admin/ping')).status).toBe(401);
    expect((await get()).status).toBe(403);
    settings.adminAddresses = [account.address.toLowerCase()];
    try {
      expect((await get()).status).toBe(200);
    } finally {
      settings.adminAddresses = [];
    }
  });
});

describe('rate limit on auth routes', () => {
  test('nonce returns 429 after 30/min per IP', async () => {
    const ip = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    let last = 200;
    for (let i = 0; i < 31; i++)
      last = (await app.request('/v1/auth/nonce', { headers: { 'cf-connecting-ip': ip } })).status;
    expect(last).toBe(429);
  });
});

test('createTestSession upserts user and stores hash', async () => {
  const s = await createTestSession('0x'.concat('ab'.repeat(20)));
  const [u] = await t.db.select().from(users);
  expect(u?.address).toBe(`0x${'ab'.repeat(20)}`);
  const [row] = await t.db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, u?.id ?? ''));
  expect(row?.tokenHash).toBe(sha256Hex(s.token));
});
