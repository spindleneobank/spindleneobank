import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { auditLog, earningEvents, epochBalances, epochs, nodes, sessions } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { buildEpoch } from '../epochs/builder';
import { epochSettings } from '../epochs/service';
import slashingRoutes from './routes';
import { banNode, slashingDeps } from './service';
import { addr, makeNode } from './testkit';

const ADMIN = addr();
const ORIGIN = 'http://localhost:7300';
const S = 3600;
const at = (h: number) => new Date((h * S + 600) * 1000);

describe('banning a node', () => {
  let t: TestDb;
  let app: Hono<Env>;
  let closed: string[];
  const realClose = slashingDeps.closeNode;
  beforeAll(async () => {
    t = await setupTestDb();
    dbRef.db = t.db;
    settings.adminAddresses = [ADMIN];
    settings.corsOrigins = [ORIGIN];
    app = new Hono<Env>();
    app.onError(jsonError);
    authRoutes(app);
    slashingRoutes(app);
  });
  afterAll(async () => {
    slashingDeps.closeNode = realClose;
    await t.close();
    await closeRedis();
  });
  beforeEach(async () => {
    await t.reset();
    closed = [];
    slashingDeps.closeNode = async (id) => void closed.push(id);
    epochSettings.treesDir = mkdtempSync(join(tmpdir(), 'trees-'));
  });

  const earn = (n: { id: string; owner: string }, micros: bigint, h = 100) =>
    t.db
      .insert(earningEvents)
      .values({ ts: at(h), nodeId: n.id, owner: n.owner, kind: 'job', usdgMicros: micros });
  const balanceOf = async (owner: string, epoch: bigint) =>
    (await t.db.select().from(epochBalances).where(eq(epochBalances.epoch, epoch))).find(
      (b) => b.owner === owner,
    )?.cumulativeUsdgMicros;

  test('suspends, closes the connection, withholds and audits', async () => {
    const n = await makeNode();
    await earn(n, 7_000_000n);
    const r = await banNode(n.id, 'served the wrong model', ADMIN);
    expect(r.withheldMicros).toBe('7000000');
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.status).toBe('suspended');
    expect(row?.suspendedReason).toBe('served the wrong model');
    expect(closed).toEqual([n.id]);
    const [log] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'node.ban'));
    expect(log?.actor).toBe(ADMIN);
    expect(log?.subject).toBe(n.id);
    expect(log?.details).toMatchObject({ reason: 'served the wrong model', withheldMicros: '7000000' });
  });

  test('a withheld earning never reaches a tree, even when built in a later hour', async () => {
    const n = await makeNode();
    const other = await makeNode();
    await earn(n, 7_000_000n);
    await earn(other, 1_000_000n);
    await banNode(n.id, 'x', ADMIN);
    const built = await buildEpoch(100n, { now: at(101) });
    expect(built.kind === 'built' && built.totalEarned).toBe(1_000_000n);
    expect(await balanceOf(n.owner, 100n)).toBeUndefined();
    expect(await balanceOf(other.owner, 100n)).toBe(1_000_000n);
  });

  test('earnings in a built but unposted root are taken back; other owners stay whole', async () => {
    const n = await makeNode();
    const other = await makeNode();
    await earn(n, 7_000_000n);
    await earn(other, 1_000_000n);
    await buildEpoch(100n, { now: at(101) });
    expect(await balanceOf(n.owner, 100n)).toBe(7_000_000n);

    const r = await banNode(n.id, 'x', ADMIN);
    expect(r.retiredEpochs).toEqual([100]);
    expect(r.withheldMicros).toBe('7000000');

    await buildEpoch(101n, { now: at(102) });
    expect(await balanceOf(n.owner, 101n)).toBeUndefined();
    expect(await balanceOf(other.owner, 101n)).toBe(1_000_000n);
  });

  test("an owner's other nodes keep their earnings", async () => {
    const n = await makeNode();
    const sibling = await makeNode({ owner: n.owner, userId: n.userId });
    await earn(n, 7_000_000n);
    await earn(sibling, 2_000_000n);
    await banNode(n.id, 'x', ADMIN);
    await buildEpoch(100n, { now: at(101) });
    expect(await balanceOf(n.owner, 100n)).toBe(2_000_000n);
  });

  test('a posted root is out of reach, but one in the veto window is named', async () => {
    const n = await makeNode();
    await earn(n, 7_000_000n);
    await buildEpoch(100n, { now: at(101) });
    await t.db.update(epochs).set({ status: 'posted', postedAt: new Date() }).where(eq(epochs.epoch, 100n));
    const r = await banNode(n.id, 'x', ADMIN);
    expect(r).toEqual({ withheldMicros: '0', retiredEpochs: [], vetoableEpochs: [100], postingEpochs: [] });
    await t.db
      .update(epochs)
      .set({ postedAt: new Date(Date.now() - 2 * S * 1000) })
      .where(eq(epochs.epoch, 100n));
    expect((await banNode(n.id, 'x', ADMIN)).vetoableEpochs).toEqual([]);
  });

  test('a root being posted is named and left alone', async () => {
    const n = await makeNode();
    await earn(n, 7_000_000n);
    await buildEpoch(100n, { now: at(101) });
    await t.db.update(epochs).set({ status: 'posting' }).where(eq(epochs.epoch, 100n));
    const r = await banNode(n.id, 'x', ADMIN);
    expect(r.postingEpochs).toEqual([100]);
    const [row] = await t.db.select().from(epochs).where(eq(epochs.epoch, 100n));
    expect(row?.status).toBe('posting');
  });

  test('banning again after a guardian veto withholds what came back', async () => {
    const n = await makeNode();
    await earn(n, 7_000_000n);
    await buildEpoch(100n, { now: at(101) });
    await t.db.update(epochs).set({ status: 'posted', postedAt: new Date() }).where(eq(epochs.epoch, 100n));
    await banNode(n.id, 'x', ADMIN);
    await t.db.update(epochs).set({ status: 'vetoed' }).where(eq(epochs.epoch, 100n));
    expect((await banNode(n.id, 'x', ADMIN)).withheldMicros).toBe('7000000');
    await buildEpoch(101n, { now: at(102) });
    expect(await balanceOf(n.owner, 101n)).toBeUndefined();
  });

  test('repeating a ban withholds nothing twice', async () => {
    const n = await makeNode();
    await earn(n, 7_000_000n);
    await banNode(n.id, 'x', ADMIN);
    expect((await banNode(n.id, 'x', ADMIN)).withheldMicros).toBe('0');
    const rows = (await t.db.select().from(earningEvents)).filter((e) => e.kind === 'ban_withhold');
    expect(rows).toHaveLength(1);
  });

  test('also takes the earnings of a node that was already suspended', async () => {
    const n = await makeNode({ status: 'suspended' });
    await earn(n, 7_000_000n);
    expect((await banNode(n.id, 'x', ADMIN)).withheldMicros).toBe('7000000');
  });

  describe('route', () => {
    const post = (id: string, headers: Record<string, string>, body: unknown = { reason: 'cheating' }) =>
      app.request(`/v1/admin/nodes/${id}/ban`, {
        method: 'POST',
        headers: { ...headers, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    test('admin only, needs a reason, and a known node', async () => {
      const n = await makeNode();
      expect((await post(n.id, { 'x-spindle': '1' })).status).toBe(401);
      const stranger = (await createTestSession(addr())).headers;
      expect((await post(n.id, stranger)).status).toBe(403);
      const admin = (await createTestSession(ADMIN)).headers;
      expect((await post(n.id, admin, {})).status).toBe(400);
      expect((await post('not-a-uuid', admin)).status).toBe(404);
      const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
      expect(row?.status).not.toBe('suspended');
      const ok = await post(n.id, admin);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ withheldMicros: '0' });
    });

    test('needs a fresh signature', async () => {
      const n = await makeNode();
      const admin = (await createTestSession(ADMIN)).headers;
      await t.db.update(sessions).set({ freshUntil: new Date(Date.now() - 1000) });
      const r = await post(n.id, admin);
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('REAUTH_REQUIRED');
      const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
      expect(row?.status).not.toBe('suspended');
    });
  });
});
