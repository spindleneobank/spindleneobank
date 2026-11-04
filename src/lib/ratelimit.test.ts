import { afterAll, describe, expect, test } from 'bun:test';
import { type Context, Hono } from 'hono';
import { type Env, jsonError } from './http';
import { clientIp, ipBucket, proxySettings, rateLimit } from './ratelimit';
import { closeRedis } from './redis';

afterAll(closeRedis);

test('rate limit returns 429 after N', async () => {
  const app = new Hono<Env>();
  app.onError(jsonError);
  const id = `t${Date.now()}${Math.random()}`;
  app.get('/x', rateLimit({ name: 'test', key: () => id, points: 3, windowSec: 30 }), (c) =>
    c.json({ ok: true }),
  );
  for (let i = 0; i < 3; i++) expect((await app.request('/x')).status).toBe(200);
  const res = await app.request('/x');
  expect(res.status).toBe(429);
  expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
});

test('empty key skips limiting', async () => {
  const app = new Hono<Env>();
  app.get('/x', rateLimit({ name: 'skip', key: () => '', points: 1, windowSec: 30 }), (c) => c.json({}));
  for (let i = 0; i < 3; i++) expect((await app.request('/x')).status).toBe(200);
});

describe('L-2: clientIp', () => {
  const ctx = (headers: Record<string, string>, peer?: string) =>
    ({
      req: { header: (n: string) => headers[n] },
      env: peer ? { requestIP: () => ({ address: peer, family: 'IPv4', port: 1 }) } : undefined,
    }) as unknown as Context;
  const spoof = { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' };

  test('proxy headers are believed from the local tunnel, direct or over the Docker bridge', () => {
    expect(clientIp(ctx(spoof, '127.0.0.1'))).toBe('1.2.3.4');
    expect(clientIp(ctx(spoof, '172.18.0.1'))).toBe('1.2.3.4');
    expect(clientIp(ctx({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }, '::1'))).toBe('5.6.7.8');
  });
  test('a client reaching the origin directly cannot pick its own bucket', () => {
    expect(clientIp(ctx(spoof, '203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIp(ctx(spoof, '172.32.0.1'))).toBe('172.32.0.1');
  });
  test('TRUST_PROXY=false ignores the headers from any peer', () => {
    proxySettings.trust = false;
    try {
      expect(clientIp(ctx(spoof, '127.0.0.1'))).toBe('127.0.0.1');
    } finally {
      proxySettings.trust = true;
    }
  });
});

test('ipBucket keeps IPv4 whole and reduces IPv6 to its /64', () => {
  expect(ipBucket('1.2.3.4')).toBe('1.2.3.4');
  expect(ipBucket('::ffff:1.2.3.4')).toBe('1.2.3.4');
  expect(ipBucket('2001:db8:1:2:3:4:5:6')).toBe(ipBucket('2001:0db8:0001:0002::9'));
  expect(ipBucket('2001:db8:1:2::1')).not.toBe(ipBucket('2001:db8:1:3::1'));
  expect(ipBucket('::1')).toBe('0000:0000:0000:0000::/64');
});
