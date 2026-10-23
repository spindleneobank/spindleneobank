import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { claims, earningEvents, epochBalances, epochs, nodes, users } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import earningsRoutes from '../earnings/routes';
import {
  CLAIM_DELAY_MS,
  csvCell,
  earningsLedger,
  earningsSeries,
  earningsSummary,
  statementCsv,
} from './service';

let t: TestDb;
const OWNER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const OTHER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const NODE = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-03-10T12:30:00.000Z');
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
});

const ev = (owner: string, ts: Date, usdgMicros: bigint, kind = 'job', jobId: string | null = null) =>
  ({ ts, nodeId: NODE, owner, kind, usdgMicros, jobId }) as typeof earningEvents.$inferInsert;

describe('series', () => {
  test('hourly buckets for 7d, split by kind, owner scoped', async () => {
    await t.db.insert(earningEvents).values([
      ev(OWNER, at('2026-03-10T11:05:00Z'), 100n),
      ev(OWNER, at('2026-03-10T11:50:00Z'), 50n),
      ev(OWNER, at('2026-03-10T11:51:00Z'), 10n, 'floor'),
      ev(OWNER, at('2026-03-10T10:10:00Z'), -30n, 'slash'),
      ev(OWNER, at('2026-03-10T10:11:00Z'), -5n, 'canary_withhold'),
      ev(OTHER, at('2026-03-10T11:05:00Z'), 999n),
      ev(OWNER, at('2026-02-01T00:00:00Z'), 777n), // outside 7d
    ]);
    const s = await earningsSeries(OWNER, '7d', NOW);
    expect(s.buckets).toEqual([
      { ts: '2026-03-10T10:00:00.000Z', jobMicros: '0', floorMicros: '0', slashMicros: '-35' },
      { ts: '2026-03-10T11:00:00.000Z', jobMicros: '150', floorMicros: '10', slashMicros: '0' },
    ]);
  });

  test('daily buckets for 30d and 90d', async () => {
    await t.db
      .insert(earningEvents)
      .values([
        ev(OWNER, at('2026-03-09T01:00:00Z'), 1n),
        ev(OWNER, at('2026-03-09T23:00:00Z'), 2n),
        ev(OWNER, at('2026-03-01T05:00:00Z'), 4n),
        ev(OWNER, at('2026-01-20T05:00:00Z'), 8n),
      ]);
    const d30 = await earningsSeries(OWNER, '30d', NOW);
    expect(d30.buckets.map((b) => [b.ts, b.jobMicros])).toEqual([
      ['2026-03-01T00:00:00.000Z', '4'],
      ['2026-03-09T00:00:00.000Z', '3'],
    ]);
    expect((await earningsSeries(OWNER, '90d', NOW)).buckets).toHaveLength(3);
  });
});

describe('summary', () => {
  test('zeros when nothing exists', async () => {
    const s = await earningsSummary(OWNER, NOW);
    expect(s).toMatchObject({
      totalEarnedMicros: '0',
      claimedMicros: '0',
      claimableMicros: '0',
      pendingMicros: '0',
      latestEpoch: null,
      claimableAt: null,
      nodes: { total: 0, online: 0 },
    });
    expect(s.nextEpochAt).toBe('2026-03-10T13:00:00.000Z');
  });

  test('total, pending, claimable from epochs and claims', async () => {
    const [u] = await t.db.insert(users).values({ address: OWNER }).returning();
    await t.db.insert(nodes).values(
      ['online', 'offline'].map((status, i) => ({
        owner: OWNER,
        userId: u?.id as string,
        nodeKey: privateKeyToAccount(generatePrivateKey()).address.toLowerCase(),
        nodePubkey: '0x04',
        name: `n${i}`,
        engine: 'ollama',
        gpuClass: 1,
        lane: 'open',
        status,
      })),
    );
    await t.db
      .insert(earningEvents)
      .values([ev(OWNER, at('2026-03-10T09:00:00Z'), 1000n), ev(OWNER, at('2026-03-10T10:00:00Z'), 500n)]);
    const posted = new Date(NOW.getTime() - CLAIM_DELAY_MS - 60_000);
    await t.db.insert(epochs).values([
      {
        epoch: 1n,
        root: '0x01',
        totalEarnedUsdgMicros: 1000n,
        owners: 1,
        treePath: 'a',
        status: 'posted',
        postedAt: posted,
      },
      {
        epoch: 2n,
        root: '0x02',
        totalEarnedUsdgMicros: 1500n,
        owners: 1,
        treePath: 'b',
        status: 'posted',
        postedAt: new Date(NOW.getTime() - 60_000),
      },
    ]);
    await t.db.insert(epochBalances).values([
      { epoch: 1n, owner: OWNER, cumulativeUsdgMicros: 1000n },
      { epoch: 2n, owner: OWNER, cumulativeUsdgMicros: 1500n },
    ]);
    await t.db
      .insert(claims)
      .values({ owner: OWNER, epoch: 1n, amountUsdgMicros: 400n, status: 'confirmed' });
    await t.db
      .insert(claims)
      .values({ owner: OWNER, epoch: 1n, amountUsdgMicros: 100n, status: 'submitted' });
    const s = await earningsSummary(OWNER, NOW);
    expect(s).toMatchObject({
      totalEarnedMicros: '1500',
      claimedMicros: '400',
      claimableMicros: '600',
      pendingMicros: '500',
      latestEpoch: 2,
      nodes: { total: 2, online: 1 },
    });
    expect(s.claimableAt).toBe(new Date(NOW.getTime() - 60_000 + CLAIM_DELAY_MS).toISOString());
  });
});

describe('ledger', () => {
  test('keyset pagination, newest first, owner scoped', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      ev(OWNER, new Date(NOW.getTime() - i * 1000), BigInt(i + 1)),
    );
    await t.db.insert(earningEvents).values([...rows, ev(OTHER, NOW, 99n)]);
    const p1 = await earningsLedger(OWNER, { limit: 2 });
    expect(p1.items.map((i) => i.micros)).toEqual(['1', '2']);
    const p2 = await earningsLedger(OWNER, { limit: 2, cursor: p1.nextCursor as string });
    expect(p2.items.map((i) => i.micros)).toEqual(['3', '4']);
    const p3 = await earningsLedger(OWNER, { limit: 2, cursor: p2.nextCursor as string });
    expect(p3.items.map((i) => i.micros)).toEqual(['5']);
    expect(p3.nextCursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items, ...p3.items].map((i) => i.id)).size).toBe(5);
  });
});

describe('ledger cursor validation', () => {
  test('malformed cursors are rejected with VALIDATION', async () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const bad = [
      enc(['2020-01-01T00:00:00.000000Z', 'not-uuid', 'job', 'not-uuid']),
      enc(['yesterday', NODE, 'job', '']),
      enc(['2020-01-01T00:00:00.000000Z', NODE, 'bogus', '']),
      '!!!',
    ];
    for (const c of bad)
      await expect(earningsLedger(OWNER, { limit: 5, cursor: c })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
  });
});

describe('statement csv', () => {
  test('csvCell escapes quotes/commas/newlines and neutralizes formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    for (const bad of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tcmd', '\rcmd']) {
      expect(csvCell(bad).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(csvCell(-5n)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });

  test('statement has header, filters by range and owner', async () => {
    await t.db
      .insert(earningEvents)
      .values([
        ev(OWNER, at('2026-03-01T00:00:00Z'), 10n),
        ev(OWNER, at('2026-03-05T00:00:00Z'), -4n, 'slash'),
        ev(OWNER, at('2026-04-01T00:00:00Z'), 7n),
        ev(OTHER, at('2026-03-05T00:00:00Z'), 99n),
      ]);
    const csv = await statementCsv(OWNER, at('2026-03-02T00:00:00Z'), at('2026-03-31T00:00:00Z'));
    expect(csv.trim().split('\r\n')).toEqual([
      'ts,node_id,job_id,kind,usdg_micros,epoch',
      `2026-03-05T00:00:00.000000Z,${NODE},,slash,-4,`,
    ]);
  });
});

describe('routes', () => {
  const app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  earningsRoutes(app);

  test('require a session; csv served as attachment', async () => {
    expect((await app.request('/v1/app/earnings/summary')).status).toBe(401);
    await t.db.insert(earningEvents).values(ev(OWNER, new Date(), 5n));
    const { headers } = await createTestSession(OWNER);
    const sum = await app.request('/v1/app/earnings/summary', { headers });
    expect(((await sum.json()) as { totalEarnedMicros: string }).totalEarnedMicros).toBe('5');
    const series = await app.request('/v1/app/earnings/series?range=30d', { headers });
    expect(((await series.json()) as { buckets: unknown[] }).buckets).toHaveLength(1);
    expect((await app.request('/v1/app/earnings/series?range=1y', { headers })).status).toBe(400);
    const led = await app.request('/v1/app/earnings/ledger?limit=10', { headers });
    expect(((await led.json()) as { items: unknown[] }).items).toHaveLength(1);
    const csv = await app.request('/v1/app/earnings/statement.csv', { headers });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('usdg_micros');
  });
});
