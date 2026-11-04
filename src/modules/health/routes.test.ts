import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../lib/http';
import health, { resetHealthCache } from './routes';

test('health responds with check fields', async () => {
  const app = new Hono<Env>();
  health(app);
  const res = await app.request('/v1/health');
  const body = (await res.json()) as Record<string, unknown>;
  expect(res.status).toBe(200);
  expect(Object.keys(body).sort()).toEqual(['chain', 'db', 'ok', 'redis', 'version']);
  expect(['ok', 'down']).toContain(body.db as string);
});

test('L-4: requests inside the cache window share one check', async () => {
  const realFetch = globalThis.fetch;
  let rpcCalls = 0;
  globalThis.fetch = (async () => {
    rpcCalls++;
    return new Response(JSON.stringify({ result: '0x1' }));
  }) as unknown as typeof fetch;
  const app = new Hono<Env>();
  health(app);
  resetHealthCache();
  try {
    await Promise.all([app.request('/v1/health'), app.request('/v1/health')]);
    await app.request('/v1/health');
    expect(rpcCalls).toBe(1);
    resetHealthCache();
    await app.request('/v1/health');
    expect(rpcCalls).toBe(2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
