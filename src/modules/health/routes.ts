import type { Hono } from 'hono';
import { config } from '../../config';
import { sql } from '../../db/client';
import type { Env } from '../../lib/http';
import { getRedis } from '../../lib/redis';

type Check = 'ok' | 'down';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const check = (fn: () => Promise<unknown>): Promise<Check> =>
  withTimeout(fn(), 2000).then(
    () => 'ok' as const,
    () => 'down' as const,
  );

async function chainCheck(): Promise<Check> {
  const url = config.RPC_URLS[0];
  if (!url) return 'down';
  return check(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(2000),
    });
    const json = (await res.json()) as { result?: string };
    if (!json.result) throw new Error('no result');
  });
}

type Health = { ok: boolean; version: string; db: Check; redis: Check; chain: Check };

export const healthSettings = { cacheMs: 5_000 };
let cached: { at: number; result: Promise<Health> } | null = null;
export const resetHealthCache = (): void => {
  cached = null;
};

async function readHealth(): Promise<Health> {
  const [db, redis, chain] = await Promise.all([
    check(() => sql`select 1`),
    check(() => getRedis().ping()),
    chainCheck(),
  ]);
  return { ok: db === 'ok' && redis === 'ok' && chain === 'ok', version: VERSION, db, redis, chain };
}

export default (app: Hono<Env>) => {
  // unauthenticated, so requests share one check: each would otherwise spend RPC quota and database time
  app.get('/v1/health', async (c) => {
    if (!cached || Date.now() - cached.at >= healthSettings.cacheMs) {
      cached = { at: Date.now(), result: readHealth() };
    }
    return c.json(await cached.result);
  });
};

const VERSION = process.env.APP_VERSION ?? '0.0.0';
