import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { auditLog, canaryResults, earningEvents, floorPayments, kv, nodes, users } from '../../db/schema';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { buildEpoch } from '../epochs/builder';
import { epochSettings } from '../epochs/service';
import {
  ALERT_KEY,
  applyFloor,
  availKey,
  decayBps,
  epochBudget,
  type FloorDeps,
  floorDay,
  floorSettings,
  markAvailable,
  onlineMinutes,
  requiredMinutes,
} from './service';

let t: TestDb;
const S = 3600;
const EPOCH = 100n; // hour [100*3600, 101*3600)
const START = '1970-01-01';
const day = (n: number) => new Date(Date.parse(`${START}T00:00:00Z`) + n * 86_400_000);
let n = 0;
const owner = () => `0x${(++n).toString(16).padStart(40, '0')}`;
let minutesByNode = new Map<string, number>();
let pool = 1_000_000_000n;
let claimed = 0n;
const deps = (): FloorDeps => ({
  chain: { poolBalance: async () => pool, totalClaimed: async () => claimed },
  minutes: async (id) => minutesByNode.get(id) ?? 0,
  now: () => new Date(),
});

async function mkNode(o: Partial<typeof nodes.$inferInsert> & { minutes?: number } = {}) {
  const addr = o.owner ?? owner();
  const [u] = await t.db.insert(users).values({ address: addr }).onConflictDoNothing().returning();
  const userId = u?.id ?? (await t.db.select().from(users).where(eq(users.address, addr)))[0]?.id;
  const { minutes, ...rest } = o;
  const [row] = await t.db
    .insert(nodes)
    .values({
      owner: addr,
      userId: userId as string,
      nodeKey: owner(),
      nodePubkey: 'pk',
      name: 'n',
      engine: 'ollama',
      gpuClass: 1,
      lane: 'open',
      registered: true,
      onchainId: BigInt(++n),
      status: 'online',
      createdAt: new Date(0),
      ...rest,
    })
    .returning();
  minutesByNode.set(row?.id as string, minutes ?? 60);
  return row as typeof nodes.$inferSelect;
}

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
  minutesByNode = new Map();
  pool = 1_000_000_000n;
  claimed = 0n;
  epochSettings.epochSeconds = S;
  epochSettings.treesDir = mkdtempSync(join(tmpdir(), 'trees-'));
  Object.assign(floorSettings, {
    startDate: START,
    epochBudgetMicros: 2_000_000n,
    nodeCapMicros: 20_000n,
    days: 90,
    minOnlineMinutes: 50,
  });
});

describe('decay', () => {
  test('exact basis points at days 0/45/89/90/120', () => {
    expect(decayBps(0)).toBe(10_000);
    expect(decayBps(45)).toBe(5_000);
    expect(decayBps(89)).toBe(112);
    expect(decayBps(90)).toBe(0);
    expect(decayBps(120)).toBe(0);
    expect(decayBps(-1)).toBe(0);
    expect(decayBps(null)).toBe(0);
  });
  test('epoch budget decays with the epoch start date and is exactly 0 from day 90', () => {
    expect(epochBudget(day(0))).toBe(2_000_000n);
    expect(epochBudget(day(45))).toBe(1_000_000n);
    expect(epochBudget(day(89))).toBe(22_400n);
    expect(epochBudget(day(90))).toBe(0n);
    expect(epochBudget(day(120))).toBe(0n);
    expect(floorDay(new Date(day(45).getTime() + 3_600_000))).toBe(45);
    expect(floorDay(day(1), '')).toBeNull();
  });
});

describe('availability bitmap', () => {
  test('one bit per minute, deduplicated', async () => {
    const id = crypto.randomUUID();
    const base = Number(EPOCH) * S * 1000;
    await markAvailable(id, base + 5_000);
    await markAvailable(id, base + 20_000); // same minute
    await markAvailable(id, base + 61_000);
    expect(await onlineMinutes(id, EPOCH)).toBe(2);
    await getRedis().del(availKey(id, EPOCH));
  });
  test('requires 50 of 60 minutes, scaled for shorter epochs', () => {
    expect(requiredMinutes()).toBe(50);
    epochSettings.epochSeconds = 600;
    expect(requiredMinutes()).toBe(9);
  });
});

describe('applyFloor', () => {
  test('splits equally, caps per node and per epoch, writes payments + unassigned floor events', async () => {
    const a = await mkNode();
    const b = await mkNode();
    // 2 nodes, budget 2,000,000 -> share 1,000,000 > cap 20,000 -> cap wins
    const r = await applyFloor(EPOCH, deps());
    expect(r).toMatchObject({ kind: 'paid', nodes: 2, perNodeMicros: 20_000n, paidMicros: 40_000n });
    const pays = await t.db.select().from(floorPayments);
    expect(pays.map((p) => p.usdgMicros)).toEqual([20_000n, 20_000n]);
    const evs = await t.db.select().from(earningEvents);
    expect(evs.every((e) => e.kind === 'floor' && e.epoch === null && e.usdgMicros === 20_000n)).toBe(true);
    expect(new Set(evs.map((e) => e.nodeId))).toEqual(new Set([a.id, b.id]));
    // the event timestamp sits inside the hour
    expect(evs[0]?.ts.getTime()).toBe((Number(EPOCH) + 1) * S * 1000 - 1);
  });

  test('epoch budget is split when it is below nodes x cap, never exceeded', async () => {
    Object.assign(floorSettings, { epochBudgetMicros: 100_000n });
    for (let i = 0; i < 7; i++) await mkNode();
    const r = await applyFloor(EPOCH, deps());
    expect(r.kind).toBe('paid');
    if (r.kind !== 'paid') return;
    expect(r.perNodeMicros).toBe(13_651n); // epoch 100 is day 4 -> 9556 bps: floor(95_560 / 7)
    expect(r.paidMicros).toBeLessThanOrEqual(100_000n);
  });

  test('is idempotent per epoch', async () => {
    await mkNode();
    expect((await applyFloor(EPOCH, deps())).kind).toBe('paid');
    expect(await applyFloor(EPOCH, deps())).toMatchObject({ kind: 'skipped', reason: 'already-applied' });
    expect(await t.db.select().from(earningEvents)).toHaveLength(1);
  });

  test('pays nothing from day 90 and before the start; disabled without a start date', async () => {
    await mkNode();
    const at = (d: number) => BigInt(Math.floor(day(d).getTime() / 1000 / S));
    expect(await applyFloor(at(90), deps())).toMatchObject({ kind: 'skipped', reason: 'zero-budget' });
    expect(await applyFloor(at(-1), deps())).toMatchObject({ kind: 'skipped', reason: 'zero-budget' });
    floorSettings.startDate = undefined;
    expect(await applyFloor(EPOCH, deps())).toMatchObject({ kind: 'skipped', reason: 'disabled' });
    expect(await t.db.select().from(floorPayments)).toHaveLength(0);
  });

  test('eligibility: suspended, unregistered, house, house owner, canary failure, short uptime, sealed w/o attestation', async () => {
    const ok = await mkNode();
    await mkNode({ status: 'suspended' });
    await mkNode({ status: 'deactivated' });
    await mkNode({ registered: false });
    await mkNode({ onchainId: null });
    await mkNode({ isHouse: true });
    await mkNode({ minutes: 49 });
    const failed = await mkNode();
    await mkNode({ lane: 'sealed' }); // no attestation
    const att = await mkNode({
      lane: 'sealed',
      lastAttestAt: new Date((Number(EPOCH) + 1) * S * 1000 - 3600_000),
    });
    await t.db.insert(canaryResults).values([
      { nodeId: failed.id, pass: false, createdAt: new Date((Number(EPOCH) * S + 600) * 1000) },
      { nodeId: ok.id, pass: false, createdAt: new Date((Number(EPOCH) - 1) * S * 1000) }, // previous epoch: irrelevant
    ]);
    const r = await applyFloor(EPOCH, deps());
    expect(r.kind).toBe('paid');
    const paid = new Set((await t.db.select().from(floorPayments)).map((p) => p.nodeId));
    expect(paid).toEqual(new Set([ok.id, att.id]));
  });

  test('solvency: skipped in full (no partial payment) and alerted when the pool cannot cover it', async () => {
    await mkNode();
    await mkNode();
    // owed = unposted job earning 500_000; pool covers owed + 39_999 only (need 40_000)
    await t.db.insert(earningEvents).values({
      ts: new Date(0),
      nodeId: crypto.randomUUID(),
      owner: owner(),
      kind: 'job',
      usdgMicros: 500_000n,
    });
    pool = 539_999n;
    const r = await applyFloor(EPOCH, deps());
    expect(r).toMatchObject({ kind: 'insolvent', neededMicros: 40_000n, shortfallMicros: 1n });
    expect(await t.db.select().from(floorPayments)).toHaveLength(0);
    expect(await t.db.select().from(earningEvents).where(eq(earningEvents.kind, 'floor'))).toHaveLength(0);
    const [alert] = await t.db.select().from(kv).where(eq(kv.key, ALERT_KEY));
    expect((alert?.value as { message: string } | undefined)?.message).toContain(
      'treasury top-up needed: 0.000001 USDG',
    );
    expect((await t.db.select().from(auditLog)).map((a) => a.action)).toEqual(['floor.skipped']);
    // retry still insolvent: no second audit row
    await applyFloor(EPOCH, deps());
    expect(await t.db.select().from(auditLog)).toHaveLength(1);
    // owner tops up: pays and clears the alert
    pool = 540_000n;
    expect((await applyFloor(EPOCH, deps())).kind).toBe('paid');
    expect(await t.db.select().from(kv).where(eq(kv.key, ALERT_KEY))).toHaveLength(0);
  });

  test('claimed amounts reduce what is owed', async () => {
    await mkNode();
    await t.db.insert(earningEvents).values({
      ts: new Date(0),
      nodeId: crypto.randomUUID(),
      owner: owner(),
      kind: 'job',
      usdgMicros: 1_000_000n,
    });
    pool = 100_000n;
    claimed = 950_000n; // owed 50_000, headroom 50_000 >= 20_000
    expect((await applyFloor(EPOCH, deps())).kind).toBe('paid');
  });

  test('floor events are included in the next epoch build', async () => {
    const a = await mkNode();
    await applyFloor(EPOCH, deps());
    const now = new Date(((Number(EPOCH) + 1) * S + 300) * 1000);
    const res = await buildEpoch(EPOCH, { now });
    expect(res.kind).toBe('built');
    if (res.kind === 'built') expect(res.totalEarned).toBe(20_000n);
    expect(a.owner).toBeTruthy();
  });
});
