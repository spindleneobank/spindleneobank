import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { desc, eq } from 'drizzle-orm';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { nodes, probeResults, slashCases } from '../../db/schema';
import { closeRedis } from '../../lib/redis';
import type { ProbeResultMsg } from '../../shared/node-protocol';
import { dbRef } from '../auth/constants';
import { slashingDeps, unsuspendNode } from '../slashing/service';
import { makeNode } from '../slashing/testkit';
import { dueNodes, evaluateProbe, probeDeps, probeNode, probeSettings, scheduleProbes } from './service';

const gpu = (name: string, vramMb: number, cc = false) => ({
  gpus: [{ name, vramMb, driver: '550', uuid: 'GPU-1', cc }],
  cpu: 'cpu',
  ramMb: 64000,
});
const bench = (tokPerSec: number) => ({ tokPerSec, ttftMs: 100, model: 'qwen2.5:7b', digest: 'sha256:a' });
const GOOD_4090 = gpu('NVIDIA GeForce RTX 4090', 24564);

describe('evaluateProbe', () => {
  test('class 2 passes at spec', () => {
    const e = evaluateProbe(2, GOOD_4090, bench(80), { hasRefModel: true });
    expect(e.classOk).toBe(true);
    expect(e.vramMb).toBe(24564);
  });
  test('slow bench misses', () => {
    const e = evaluateProbe(2, GOOD_4090, bench(30), { hasRefModel: true });
    expect(e.classOk).toBe(false);
    expect(e.reasons.join()).toContain('tok/s');
  });
  test('smaller GPU than claimed misses on class and vram', () => {
    const e = evaluateProbe(2, gpu('NVIDIA GeForce RTX 3060', 12288), bench(80), { hasRefModel: true });
    expect(e.classOk).toBe(false);
    expect(e.reasons.length).toBe(2);
  });
  test('empty bench misses only when the node holds the reference model', () => {
    expect(evaluateProbe(2, GOOD_4090, undefined, { hasRefModel: true }).classOk).toBe(false);
    const skipped = evaluateProbe(2, GOOD_4090, undefined, { hasRefModel: false });
    expect(skipped.classOk).toBe(true);
    expect(skipped.benchSkipped).toBe(true);
  });
  test('missing hardware report misses', () => {
    expect(evaluateProbe(2, undefined, bench(80), { hasRefModel: true }).classOk).toBe(false);
  });
  test('class 0 (CPU) only needs the minimal speed', () => {
    expect(evaluateProbe(0, gpu('cpu', 0), bench(5), { hasRefModel: true }).classOk).toBe(true);
  });
  test('sealed class needs a CC flag', () => {
    expect(
      evaluateProbe(3, gpu('NVIDIA H100 80GB', 81559, false), bench(50), { hasRefModel: true }).classOk,
    ).toBe(false);
    expect(
      evaluateProbe(3, gpu('NVIDIA H100 80GB', 81559, true), bench(50), { hasRefModel: true }).classOk,
    ).toBe(true);
  });
});

describe('probe flow', () => {
  let t: TestDb;
  let closed: string[];
  let hw: ProbeResultMsg['hardware'];
  let bn: ProbeResultMsg['bench'];
  const realClose = slashingDeps.closeNode;
  const realProbe = probeDeps.probe;
  beforeAll(async () => {
    t = await setupTestDb();
    dbRef.db = t.db;
  });
  afterAll(async () => {
    slashingDeps.closeNode = realClose;
    probeDeps.probe = realProbe;
    await t.close();
    await closeRedis();
  });
  beforeEach(async () => {
    await t.reset();
    closed = [];
    hw = GOOD_4090;
    bn = bench(80);
    slashingDeps.closeNode = async (id) => void closed.push(id);
    probeDeps.probe = async (_id, kind) =>
      kind === 'hardware'
        ? { v: 1, type: 'probe.result', probeId: 'p', hardware: hw }
        : { v: 1, type: 'probe.result', probeId: 'p', bench: bn };
  });

  test('a pass stores the result and updates last_probe_at and benchmark', async () => {
    const n = await makeNode();
    expect(await probeNode(n.id)).toEqual({ classOk: true, suspended: false });
    const [r] = await t.db.select().from(probeResults);
    expect(r?.classOk).toBe(true);
    expect(r?.vramGb).toBe(24);
    expect(Number(r?.tokPerSec)).toBe(80);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.lastProbeAt).not.toBeNull();
    expect((row?.benchmark as { tokPerSec: number }).tokPerSec).toBe(80);
  });

  test('2 consecutive misses suspend; one miss does not', async () => {
    const n = await makeNode();
    bn = bench(10);
    expect(await probeNode(n.id)).toEqual({ classOk: false, suspended: false });
    bn = bench(80);
    expect((await probeNode(n.id))?.classOk).toBe(true); // streak broken
    bn = bench(10);
    expect((await probeNode(n.id))?.suspended).toBe(false);
    expect(await probeNode(n.id)).toEqual({ classOk: false, suspended: true });
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.status).toBe('suspended');
    expect(closed).toEqual([n.id]);
  });

  test('slash case only for a staked node, at 10%', async () => {
    const unstaked = await makeNode();
    const staked = await makeNode({ stakeSpdl: '1000000000000000000' });
    bn = bench(1);
    for (const n of [unstaked, staked]) {
      await probeNode(n.id);
      await probeNode(n.id);
    }
    const cases = await t.db.select().from(slashCases);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.nodeId).toBe(staked.id);
    expect(cases[0]?.reason).toBe('probe_misrepresentation');
    expect(cases[0]?.proposedBps).toBe(1000);
    const [u] = await t.db.select().from(nodes).where(eq(nodes.id, unstaked.id));
    expect(u?.status).toBe('suspended');
  });

  test('the house node is probed but never suspended', async () => {
    const h = await makeNode({ isHouse: true, gpuClass: 0, stakeSpdl: '5' });
    bn = bench(0.1);
    await probeNode(h.id);
    expect((await probeNode(h.id))?.suspended).toBe(false);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, h.id));
    expect(row?.status).toBe('online');
    expect(await t.db.select().from(slashCases)).toHaveLength(0);
  });

  test('misses before an unsuspend do not count afterwards', async () => {
    const n = await makeNode();
    bn = bench(1);
    await probeNode(n.id);
    await probeNode(n.id);
    await unsuspendNode(n.id, '0xadmin');
    await t.db.update(nodes).set({ status: 'online' }).where(eq(nodes.id, n.id));
    await Bun.sleep(5);
    expect((await probeNode(n.id))?.suspended).toBe(false);
    const rows = await t.db.select().from(probeResults).orderBy(desc(probeResults.createdAt));
    expect(rows).toHaveLength(3);
  });

  test('transport failure is inconclusive: nothing stored', async () => {
    const n = await makeNode();
    probeDeps.probe = async () => {
      throw new Error('node offline');
    };
    expect(await probeNode(n.id)).toBeNull();
    expect(await t.db.select().from(probeResults)).toHaveLength(0);
  });

  test('schedule: only registered online nodes whose last probe is older than 6h, capped per tick', async () => {
    const now = Date.now();
    const fresh = await makeNode({ lastProbeAt: new Date(now - 3600_000) });
    const old = await makeNode({ lastProbeAt: new Date(now - 7 * 3600_000) });
    const never = await makeNode();
    await makeNode({ registered: false });
    await makeNode({ status: 'offline' });
    const due = await dueNodes(now);
    expect(due).toContain(old.id);
    expect(due).toContain(never.id);
    expect(due).not.toContain(fresh.id);
    expect(due).toHaveLength(2);
    probeSettings.perTick = 1;
    try {
      expect(await scheduleProbes()).toHaveLength(1);
    } finally {
      probeSettings.perTick = 5;
    }
  });
});
