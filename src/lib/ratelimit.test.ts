import { afterAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { type Env, jsonError } from './http';
import { rateLimit } from './ratelimit';
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
