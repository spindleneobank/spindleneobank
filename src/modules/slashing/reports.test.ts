import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { auditLog, earningEvents, jobReports, jobs, nodes, receipts, sessions } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { buyerIdForAddress } from '../buyers/service';
import { resetJobFinishedHandler } from '../gateway/service';
import receiptRoutes from '../receipts/routes';
import { REPORT_WINDOW_MS } from '../receipts/service';
import slashingRoutes from './routes';
import { slashingDeps } from './service';
import { addr, makeNode } from './testkit';

const ADMIN = addr();
const ORIGIN = 'http://localhost:7300';

describe('job reports', () => {
  let t: TestDb;
  let app: Hono<Env>;
  let buyer: string;
  let as: Record<string, string>;
  const realClose = slashingDeps.closeNode;
  beforeAll(async () => {
    t = await setupTestDb();
    dbRef.db = t.db;
    settings.adminAddresses = [ADMIN];
    settings.corsOrigins = [ORIGIN];
    app = new Hono<Env>();
    app.onError(jsonError);
    authRoutes(app);
    receiptRoutes(app);
    slashingRoutes(app);
    resetJobFinishedHandler();
  });
  afterAll(async () => {
    slashingDeps.closeNode = realClose;
    await t.close();
    await closeRedis();
  });
  beforeEach(async () => {
    await t.reset();
    for (const k of await getRedis().keys('rl:job_report:*')) await getRedis().del(k);
    slashingDeps.closeNode = async () => {};
    buyer = addr();
    as = (await createTestSession(buyer)).headers;
  });

  const paidJob = async (nodeId: string, over: Partial<typeof jobs.$inferInsert> = {}) => {
    const [j] = await t.db
      .insert(jobs)
      .values({
        buyerId: await buyerIdForAddress(buyer),
        nodeId,
        lane: 'open',
        model: 'qwen2.5:7b',
        kind: 'chat',
        unitKind: 'tokens_1m',
        payMode: 'balance',
        status: 'completed',
        buyerUsdgMicros: 1000n,
        ...over,
      })
      .returning();
    await t.db.insert(receipts).values({
      jobId: j?.id as string,
      nodeId,
      cose: new Uint8Array([1, 2, 3]),
      payload: { model: 'qwen2.5:7b' },
      verified: true,
    });
    return j?.id as string;
  };
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...headers, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const report = (
    jobId: string,
    headers = as,
    body: unknown = { reason: 'wrong_model', details: 'gibberish' },
  ) => call('POST', `/v1/app/receipts/${jobId}/report`, headers, body);
  const admin = async () => (await createTestSession(ADMIN)).headers;
  const nodeRow = async (id: string) => (await t.db.select().from(nodes).where(eq(nodes.id, id)))[0];

  describe('filing', () => {
    test('the buyer can report a paid job, once; nothing happens to the node', async () => {
      const n = await makeNode();
      const jobId = await paidJob(n.id);
      const r = await report(jobId);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ status: 'open' });
      expect((await report(jobId)).status).toBe(409);
      const [row] = await t.db.select().from(jobReports);
      expect(row).toMatchObject({
        jobId,
        nodeId: n.id,
        reporter: buyer,
        reason: 'wrong_model',
        details: 'gibberish',
      });
      expect((await nodeRow(n.id))?.status).toBe('online');
    });

    test('not signed in, or not your job: 401 and 404', async () => {
      const n = await makeNode();
      const jobId = await paidJob(n.id);
      expect((await report(jobId, { 'x-spindle': '1' })).status).toBe(401);
      expect((await report(jobId, (await createTestSession(addr())).headers)).status).toBe(404);
      // the node's owner sees the receipt but cannot report the job
      expect((await report(jobId, (await createTestSession(n.owner)).headers)).status).toBe(404);
      expect((await report(crypto.randomUUID())).status).toBe(404);
      expect((await report('not-a-uuid')).status).toBe(404);
      expect(await t.db.select().from(jobReports)).toHaveLength(0);
    });

    test('an unpaid job or one past the window cannot be reported', async () => {
      const n = await makeNode();
      expect((await report(await paidJob(n.id, { buyerUsdgMicros: 0n }))).status).toBe(409);
      const old = new Date(Date.now() - REPORT_WINDOW_MS - 1000);
      expect((await report(await paidJob(n.id, { createdAt: old }))).status).toBe(409);
    });

    test('a bad body is refused', async () => {
      const n = await makeNode();
      const jobId = await paidJob(n.id);
      expect((await report(jobId, as, { reason: 'nope' })).status).toBe(400);
      expect((await report(jobId, as, { reason: 'other', details: 'x'.repeat(2001) })).status).toBe(400);
    });

    test('filing is rate limited per account', async () => {
      const n = await makeNode();
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await report(await paidJob(n.id))).status);
      expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
      expect(statuses[20]).toBe(429);
    });

    test('the receipt tells the buyer, and only the buyer, whether they can report', async () => {
      const n = await makeNode();
      const jobId = await paidJob(n.id);
      const view = async (h: Record<string, string>) =>
        (await (await call('GET', `/v1/app/receipts/${jobId}`, h)).json()) as { canReport: boolean };
      expect((await view(as)).canReport).toBe(true);
      expect((await view((await createTestSession(n.owner)).headers)).canReport).toBe(false);
      await report(jobId);
      expect((await view(as)).canReport).toBe(false);
    });
  });

  describe('review', () => {
    test('the admin list carries the job, its receipt, the note and the count for the node', async () => {
      const n = await makeNode();
      const jobId = await paidJob(n.id);
      await report(jobId);
      await report(await paidJob(n.id));
      const r = await call('GET', '/v1/admin/job-reports', await admin());
      expect(r.status).toBe(200);
      const list = (await r.json()) as { job: { id: string } }[];
      expect(list).toHaveLength(2);
      const item = list.find((x) => x.job.id === jobId);
      expect(item).toMatchObject({
        reason: 'wrong_model',
        details: 'gibberish',
        reporter: buyer,
        openReportsOnNode: 2,
        node: { id: n.id, owner: n.owner },
        job: { model: 'qwen2.5:7b', chargeMicros: '1000' },
        receipt: { verified: true, cose: 'AQID' },
      });
    });

    test('admin only', async () => {
      expect((await call('GET', '/v1/admin/job-reports', { 'x-spindle': '1' })).status).toBe(401);
      const stranger = (await createTestSession(addr())).headers;
      expect((await call('GET', '/v1/admin/job-reports', stranger)).status).toBe(403);
      const body = { resolution: 'x' };
      const id = crypto.randomUUID();
      expect((await call('POST', `/v1/admin/job-reports/${id}/uphold`, stranger, body)).status).toBe(403);
      expect((await call('POST', `/v1/admin/job-reports/${id}/dismiss`, stranger, body)).status).toBe(403);
    });

    test('uphold bans the node and withholds its earnings', async () => {
      const n = await makeNode();
      await t.db
        .insert(earningEvents)
        .values({ ts: new Date(), nodeId: n.id, owner: n.owner, kind: 'job', usdgMicros: 5000n });
      await report(await paidJob(n.id));
      const [row] = await t.db.select().from(jobReports);
      const r = await call('POST', `/v1/admin/job-reports/${row?.id}/uphold`, await admin(), {
        resolution: 'output was another model',
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ status: 'upheld', withheldMicros: '5000' });
      expect((await nodeRow(n.id))?.status).toBe('suspended');
      const [after] = await t.db.select().from(jobReports);
      expect(after).toMatchObject({
        status: 'upheld',
        resolution: 'output was another model',
        resolvedBy: ADMIN,
      });
      const actions = (await t.db.select().from(auditLog)).map((a) => a.action);
      expect(actions).toContain('job_report.uphold');
      expect(actions).toContain('node.ban');
    });

    test('dismiss leaves the node alone, and a report is only decided once', async () => {
      const n = await makeNode();
      await report(await paidJob(n.id));
      const [row] = await t.db.select().from(jobReports);
      const a = await admin();
      const path = `/v1/admin/job-reports/${row?.id}`;
      expect((await call('POST', `${path}/dismiss`, a, { resolution: 'output looks fine' })).status).toBe(
        200,
      );
      expect((await nodeRow(n.id))?.status).toBe('online');
      expect((await call('POST', `${path}/uphold`, a, { resolution: 'changed my mind' })).status).toBe(409);
      expect((await nodeRow(n.id))?.status).toBe('online');
      const dismissed = await call('GET', '/v1/admin/job-reports?status=dismissed', a);
      expect((await dismissed.json()) as unknown[]).toHaveLength(1);
      expect((await (await call('GET', '/v1/admin/job-reports', a)).json()) as unknown[]).toHaveLength(0);
    });

    test('deciding needs a reason and a fresh signature', async () => {
      const n = await makeNode();
      await report(await paidJob(n.id));
      const [row] = await t.db.select().from(jobReports);
      const a = await admin();
      expect((await call('POST', `/v1/admin/job-reports/${row?.id}/uphold`, a, {})).status).toBe(400);
      await t.db.update(sessions).set({ freshUntil: new Date(Date.now() - 1000) });
      const r = await call('POST', `/v1/admin/job-reports/${row?.id}/uphold`, a, { resolution: 'x' });
      expect(r.status).toBe(403);
      expect((await nodeRow(n.id))?.status).toBe('online');
    });
  });
});
