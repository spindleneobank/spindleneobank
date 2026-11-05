import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { canaryResults, earningEvents, nodes, slashCases } from '../../db/schema';
import { closeRedis } from '../../lib/redis';
import { DEFAULT_CATALOG } from '../../shared/catalog';
import { dbRef } from '../auth/constants';
import { slashingDeps, unsuspendNode } from '../slashing/service';
import { makeCanaryJob, makeNode, seedCanaries } from '../slashing/testkit';
import { corpusSettings } from './corpus';
import { canaryHooks } from './hooks';
import {
  canaryDeps,
  canaryProbability,
  canarySettings,
  clampReputation,
  cosine,
  evaluateChat,
  evaluateEmbeddings,
  pendingSpecCount,
  recordCanaryResult,
  scheduleCanaries,
  sendCanary,
  sweepSpecs,
  withholdAmount,
} from './service';

describe('chat evaluation', () => {
  const word = { anyOf: ['paris'] };
  test('word answers are case insensitive', () => {
    expect(evaluateChat(word, 'Paris')).toBe(true);
    expect(evaluateChat(word, 'It is PARIS.')).toBe(true);
    expect(evaluateChat(word, 'London')).toBe(false);
    expect(evaluateChat(word, '')).toBe(false);
  });
});

describe('embedding evaluation', () => {
  const ref = [
    [1, 0, 0],
    [0, 1, 0],
  ];
  test('cosine', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
  });
  test('pass at >= 0.98, fail below, fail on zero or missing vectors', () => {
    const near = [
      [1, 0.05, 0],
      [0.05, 1, 0],
    ];
    expect(evaluateEmbeddings(ref, near).pass).toBe(true);
    const off = [
      [1, 0.3, 0],
      [0, 1, 0],
    ];
    const r = evaluateEmbeddings(ref, off);
    expect(r.pass).toBe(false);
    expect(r.minCosine).toBeLessThan(0.98);
    expect(
      evaluateEmbeddings(ref, [
        [0, 0, 0],
        [0, 0, 0],
      ]).pass,
    ).toBe(false);
    expect(evaluateEmbeddings(ref, [[1, 0, 0]]).pass).toBe(false);
  });
});

describe('math', () => {
  test('withhold amount is the whole positive balance, never more', () => {
    expect(withholdAmount(5_000_000n)).toBe(-5_000_000n);
    expect(withholdAmount(0n)).toBe(0n);
    expect(withholdAmount(-3n)).toBe(0n);
  });
  test('reputation is clamped', () => {
    expect(clampReputation(1000, 2)).toBe(1002);
    expect(clampReputation(30, -100)).toBe(0);
    expect(clampReputation(1999, 2)).toBe(2000);
  });
  test('probability is 2% of last-hour jobs spread over 60 ticks', () => {
    expect(canaryProbability(0, 200)).toBe(0);
    expect(canaryProbability(3000, 200)).toBeCloseTo(1, 10); // 60 canaries/h -> every tick
    expect(canaryProbability(300, 200)).toBeCloseTo(0.1, 10);
    expect(canaryProbability(1_000_000, 200)).toBe(1);
  });
});

describe('results, withholds, escalation', () => {
  let t: TestDb;
  let closed: string[];
  const realClose = slashingDeps.closeNode;
  const realCorpus = corpusSettings.path;
  beforeAll(async () => {
    t = await setupTestDb();
    dbRef.db = t.db;
    corpusSettings.path = new URL('../../../test/fixtures/canary-corpus.jsonl', import.meta.url).pathname;
  });
  afterAll(async () => {
    corpusSettings.path = realCorpus;
    slashingDeps.closeNode = realClose;
    await t.close();
    await closeRedis();
  });
  beforeEach(async () => {
    await t.reset();
    closed = [];
    slashingDeps.closeNode = async (id) => void closed.push(id);
  });

  const earn = (nodeId: string, owner: string, micros: bigint, epoch: bigint | null = null) =>
    t.db
      .insert(earningEvents)
      .values({ ts: new Date(), nodeId, owner, kind: 'job', usdgMicros: micros, epoch });

  async function fail(nodeId: string) {
    return recordCanaryResult({
      nodeId,
      jobId: await makeCanaryJob(nodeId),
      kind: 'chat',
      expected: { x: 1 },
      observed: { text: 'ok' },
      pass: false,
    });
  }

  test('pass: reputation +2, no earning event', async () => {
    const n = await makeNode();
    await recordCanaryResult({
      nodeId: n.id,
      jobId: null,
      kind: 'chat',
      expected: {},
      observed: {},
      pass: true,
    });
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.reputation).toBe(1002);
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
    expect((await t.db.select().from(canaryResults))[0]?.pass).toBe(true);
  });

  test('fail with a full sample: reputation -100 and withhold of exactly the unbuilt-epoch earnings', async () => {
    const n = await makeNode();
    await earn(n.id, n.owner, 3_000_000n);
    await earn(n.id, n.owner, 2_000_000n);
    await earn(n.id, n.owner, 9_000_000n, 41n); // already built epoch: untouched
    await seedCanaries(n.id, 2, 2);
    const r = await fail(n.id); // 5 canaries, 3 failed
    expect(r.withheld).toBe(-5_000_000n);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.reputation).toBe(900);
    const w = (await t.db.select().from(earningEvents)).filter((e) => e.kind === 'canary_withhold');
    expect(w).toHaveLength(1);
    expect(w[0]?.usdgMicros).toBe(-5_000_000n);
    expect(w[0]?.epoch).toBeNull();
    // L-12: dated with the earliest earning it cancels, so no build can take the earning without the withhold
    const earned = (await t.db.select().from(earningEvents)).filter((e) => e.kind === 'job' && !e.epoch);
    const earliest = Math.min(...earned.map((e) => e.ts.getTime()));
    expect(w[0]?.ts.getTime()).toBe(earliest);
  });

  test('a node is not judged on fewer than 5 canaries', async () => {
    const n = await makeNode();
    await earn(n.id, n.owner, 1_000_000n);
    for (let i = 0; i < 4; i++) expect((await fail(n.id)).withheld).toBe(0n);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.reputation).toBe(1000);
    expect(row?.status).toBe('online');
    expect(await t.db.select().from(slashCases)).toHaveLength(0);
    expect((await fail(n.id)).suspended).toBe(true); // the 5th: 5/5 failed
  });

  test('fewer than half failing is not a failure event', async () => {
    const n = await makeNode();
    await earn(n.id, n.owner, 1_000_000n);
    await seedCanaries(n.id, 1, 4);
    const r = await fail(n.id); // 2 of 6
    expect(r.withheld).toBe(0n);
    expect(r.suspended).toBe(false);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.reputation).toBe(1000);
  });

  test('a failed first attempt is stored but counts for nothing until the retry', async () => {
    const n = await makeNode();
    await earn(n.id, n.owner, 1_000_000n);
    await seedCanaries(n.id, 4, 0);
    const r = await recordCanaryResult({
      nodeId: n.id,
      jobId: await makeCanaryJob(n.id),
      kind: 'chat',
      expected: {},
      observed: { text: 'x' },
      pass: false,
      final: false,
    });
    expect(r).toEqual({ withheld: 0n, suspended: false });
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.reputation).toBe(1000);
    expect(
      (await t.db.select().from(canaryResults)).filter(
        (c) => (c.observed as { attempt?: number }).attempt === 1,
      ),
    ).toHaveLength(1);
    // the superseded row is not part of the sample: 4 counted fails + this retry failing = 5
    const rr = await fail(n.id);
    expect(rr.suspended).toBe(true);
    expect(rr.withheld).toBe(-1_000_000n);
  });

  test('a second failure in the same epoch withholds nothing more (net is zero)', async () => {
    const n = await makeNode();
    await earn(n.id, n.owner, 1_000_000n);
    await seedCanaries(n.id, 4, 0);
    await fail(n.id);
    const r = await fail(n.id);
    expect(r.withheld).toBe(0n);
    const net = (await t.db.select().from(earningEvents)).reduce((a, e) => a + e.usdgMicros, 0n);
    expect(net).toBe(0n);
  });

  test('fail with no earnings writes no withhold row', async () => {
    const n = await makeNode();
    await seedCanaries(n.id, 4, 0);
    const r = await fail(n.id);
    expect(r.withheld).toBe(0n);
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
  });

  test('3+ failures in a failing sample: suspended, closed, one slash case at 20%', async () => {
    const n = await makeNode();
    await seedCanaries(n.id, 2, 2);
    const r = await fail(n.id);
    expect(r.suspended).toBe(true);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.status).toBe('suspended');
    expect(closed).toEqual([n.id]);
    const cases = await t.db.select().from(slashCases);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.reason).toBe('canary_fraud');
    expect(cases[0]?.proposedBps).toBe(2000);
    expect(cases[0]?.status).toBe('open');
  });

  test('re-offence after unsuspend opens a fresh case and supersedes the stale open one', async () => {
    const n = await makeNode();
    await seedCanaries(n.id, 4, 0);
    await fail(n.id);
    const [first] = await t.db.select().from(slashCases);
    await unsuspendNode(n.id, '0xadmin');
    await Bun.sleep(10);
    await seedCanaries(n.id, 4, 0);
    await fail(n.id);
    const cases = await t.db.select().from(slashCases);
    expect(cases).toHaveLength(2);
    expect(cases.filter((c) => c.status === 'open')).toHaveLength(1);
    expect(cases.find((c) => c.id === first?.id)?.status).toBe('dismissed');
  });

  test('specs of canaries that never finish are swept after the TTL', async () => {
    const n = await makeNode();
    const real = { ...canaryDeps };
    let release: (e: Error) => void = () => {};
    canaryDeps.candidates = async () => [];
    canaryDeps.dispatch = () => new Promise((_, rej) => (release = rej));
    const sent = sendCanary({
      node: { nodeId: n.id, isHouse: false, engine: 'ollama' },
      model: DEFAULT_CATALOG.find((m) => m.id === 'qwen2.5:7b') as never,
    });
    try {
      await Bun.sleep(50);
      expect(pendingSpecCount()).toBe(1);
      expect(sweepSpecs(Date.now() + 14 * 60_000)).toBe(0);
      expect(sweepSpecs(Date.now() + 16 * 60_000)).toBe(1);
      expect(pendingSpecCount()).toBe(0);
    } finally {
      release(new Error('done'));
      await sent;
      Object.assign(canaryDeps, real);
    }
    expect(pendingSpecCount()).toBe(0); // terminal path also clears
  });

  test('the house node is never penalised or suspended', async () => {
    const n = await makeNode({ isHouse: true, gpuClass: 0 });
    for (let i = 0; i < 6; i++) await fail(n.id);
    const [row] = await t.db.select().from(nodes).where(eq(nodes.id, n.id));
    expect(row?.status).toBe('online');
    expect(row?.reputation).toBe(1000);
    expect(await t.db.select().from(canaryResults)).toHaveLength(0);
  });

  test('default hook turns an unverified canary receipt into a failure', async () => {
    const n = await makeNode();
    const jobId = await makeCanaryJob(n.id);
    await canaryHooks.onCanaryFinished({ jobId, nodeId: n.id, verified: false, reason: 'BAD_SIGNATURE' });
    const [res] = await t.db.select().from(canaryResults);
    expect(res?.pass).toBe(false);
    expect(res?.observed).toMatchObject({ receipt: 'BAD_SIGNATURE' });
  });

  test('scheduler: house excluded, every node gets at least one per hour, none when recent', async () => {
    const a = await makeNode();
    const house = await makeNode({ isHouse: true, gpuClass: 0 });
    const sentTo: string[] = [];
    const real = { ...canaryDeps };
    canaryDeps.candidates = async (f) =>
      f.model === 'qwen2.5:7b'
        ? [
            { nodeId: a.id, isHouse: false, engine: 'ollama' },
            { nodeId: house.id, isHouse: true, engine: 'ollama' },
          ]
        : [];
    canaryDeps.dispatch = async (nodeId) => {
      sentTo.push(nodeId);
      throw new Error('stop here');
    };
    try {
      expect(await scheduleCanaries()).toEqual([a.id]);
      await Bun.sleep(100);
      expect(sentTo).toEqual([a.id]);
      // a canary job now exists for the node, so the next tick (no traffic) sends nothing
      canaryDeps.random = () => 0.999;
      expect(await scheduleCanaries()).toEqual([]);
      expect(canarySettings.rateBps).toBeGreaterThanOrEqual(0);
    } finally {
      Object.assign(canaryDeps, real);
    }
  });
});
