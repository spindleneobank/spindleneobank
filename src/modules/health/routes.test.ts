import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../lib/http';
import health from './routes';

test('health responds with check fields', async () => {
  const app = new Hono<Env>();
  health(app);
  const res = await app.request('/v1/health');
  const body = (await res.json()) as Record<string, unknown>;
  expect(res.status).toBe(200);
  expect(Object.keys(body).sort()).toEqual(['chain', 'db', 'ok', 'redis', 'version']);
  expect(['ok', 'down']).toContain(body.db as string);
});
