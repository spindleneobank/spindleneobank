import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { z } from 'zod';
import { jobs, nodes } from '../../db/schema';
import type { Env } from '../../lib/http';
import { logger } from '../../lib/logger';
import { getRedis } from '../../lib/redis';
import type { GetNetworkStatsRes } from '../../shared/api/public';
import { dbRef } from '../auth/constants';
import { latestPostedEpoch } from '../epochs/service';

export const NETWORK_STATS_KEY = 'network:stats';
export const NETWORK_STATS_TTL_SEC = 30;
type Stats = z.infer<typeof GetNetworkStatsRes>;

export async function computeNetworkStats(): Promise<Stats> {
  const db = dbRef.db;
  const laneRows = await db
    .select({ lane: nodes.lane, n: count() })
    .from(nodes)
    .where(and(eq(nodes.registered, true), inArray(nodes.status, ['online', 'busy'])))
    .groupBy(nodes.lane);
  const byLane = { sealed: 0, open: 0 };
  for (const r of laneRows) if (r.lane === 'sealed' || r.lane === 'open') byLane[r.lane] = r.n;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [j] = await db
    .select({
      n: count(),
      tokens: sql<string>`coalesce(sum(coalesce(${jobs.promptTokens},0) + coalesce(${jobs.completionTokens},0)),0)`,
    })
    .from(jobs)
    .where(and(eq(jobs.status, 'completed'), gte(jobs.finishedAt, since)));
  const latest = await latestPostedEpoch();
  return {
    nodesOnline: byLane.sealed + byLane.open,
    nodesByLane: byLane,
    jobs24h: j?.n ?? 0,
    tokens24h: Number(j?.tokens ?? 0),
    latestEpoch: latest ? Number(latest.epoch) : null,
  };
}

export async function networkStats(): Promise<Stats> {
  try {
    const hit = await getRedis().get(NETWORK_STATS_KEY);
    if (hit) return JSON.parse(hit) as Stats;
  } catch (err) {
    logger.warn({ err: String(err) }, 'network stats cache read failed');
  }
  const stats = await computeNetworkStats();
  try {
    await getRedis().set(NETWORK_STATS_KEY, JSON.stringify(stats), 'EX', NETWORK_STATS_TTL_SEC);
  } catch (err) {
    logger.warn({ err: String(err) }, 'network stats cache write failed');
  }
  return stats;
}

export default function networkRoutes(app: Hono<Env>): void {
  app.get('/v1/network/stats', async (c) => {
    c.header('cache-control', 'public, max-age=30');
    return c.json(await networkStats());
  });
}
