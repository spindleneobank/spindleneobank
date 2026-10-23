/**
 * End to end through the real hub: an N1 agent job runner with `lazy: true` (what SPINDLE_DEV_LAZY=1
 * enables: chat returns "ok" without running an engine) is sent canaries, fails them, loses its epoch
 * earnings, gets suspended and is turned into a slash case. An honest runner passes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { JobRunner } from '../../../node/src/jobs';
import { createLogger } from '../../../node/src/log';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { buyerLedger, canaryResults, earningEvents, jobs, nodes, slashCases, users } from '../../db/schema';
import { closeRedis } from '../../lib/redis';
import { DEFAULT_CATALOG } from '../../shared/catalog';
import { CLOSE_CODES } from '../../shared/node-protocol';
import { dbRef } from '../auth/constants';
import { tokenizerSettings } from '../gateway/tokenizer';
import { createEnrollment } from '../nodes/enroll';
import { nodeHub } from '../nodes/hub';
import { nodeSettings, setStakingParamsForTest } from '../nodes/service';
import { type FakeNode, fakeNode, startTestServer } from '../nodes/testing';
import { slashingDeps } from '../slashing/service';
import { addr } from '../slashing/testkit';
import { CHAT_FIXTURES } from './fixtures';
import { canaryDeps, sendCanary } from './service';

const MODEL = DEFAULT_CATALOG.find((m) => m.id === 'qwen2.5:7b') as (typeof DEFAULT_CATALOG)[number];

let t: TestDb;
let srv: ReturnType<typeof startTestServer>;
let userId: string;
const OWNER = addr();
const toStop: FakeNode[] = [];
const real = { ...canaryDeps };
const realClose = slashingDeps.closeNode;

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  srv = startTestServer();
  nodeSettings.registry = '0x00000000000000000000000000000000000000b2';
  setStakingParamsForTest({
    token: '0x00000000000000000000000000000000000000c3',
    minStakeByClass: { '0': '0', '1': '100', '2': '200', '3': '300', '4': '400' },
    unstakeDelay: 604800,
  });
  await nodeHub.start({ redis: false });
  tokenizerSettings.load = async () => {
    throw new Error('offline');
  };
  // the worker talks to the hub over Redis in production; here it is the same process
  canaryDeps.candidates = async (f) =>
    nodeHub.candidates({ ...f }).map((c) => ({ nodeId: c.nodeId, isHouse: c.isHouse, engine: c.engine }));
  canaryDeps.dispatch = async (nodeId, job, onChunk) => {
    const h = nodeHub.dispatch(nodeId, job);
    for await (const c of h.chunks) onChunk(c);
    return h.done;
  };
  slashingDeps.closeNode = async (id) => nodeHub.closeNode(id, CLOSE_CODES.SUSPENDED);
});
afterAll(async () => {
  Object.assign(canaryDeps, real);
  slashingDeps.closeNode = realClose;
  setStakingParamsForTest(null);
  await nodeHub.stop();
  srv.stop();
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  const [u] = await t.db.insert(users).values({ address: OWNER }).returning();
  userId = u?.id as string;
});
afterEach(async () => {
  for (const n of toStop.splice(0)) n.conn.stop();
  for (let i = 0; i < 100 && nodeHub.onlineNodeIds().length > 0; i++) await Bun.sleep(10);
  await Bun.sleep(30);
});

async function agent(lazy: boolean) {
  const { token } = await createEnrollment(userId, { engine: 'ollama', os: 'linux', name: 'rig' });
  let runner: JobRunner | undefined;
  const n = fakeNode({
    wsUrl: srv.wsUrl,
    token,
    gpu: { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576 },
    models: ['qwen2.5:7b'],
    onJob: (node, job) => {
      runner ??= new JobRunner({
        engine: {
          kind: 'ollama',
          listModels: async () => [{ id: 'qwen2.5:7b', digest: 'sha256:abc', sizeMb: 1 }],
          ensureModel: async () => 'sha256:abc',
          // an honest engine that knows the answer to the first fixture ("What is 17 + 25?")
          chatStream: async function* () {
            yield { content: '42', usage: { promptTokens: 20, completionTokens: 1 } };
          },
          chat: async () => ({}),
          embeddings: async () => ({}),
          version: async () => '0',
        },
        key: {
          privateKey: node.privateKey,
          address: node.address,
          publicKey: node.account.publicKey,
          createdAt: '',
          account: node.account,
        },
        send: (m) => node.conn.send(m),
        log: createLogger('error', () => {}),
        agentVersion: '0.1.0',
        lazy,
        batchMs: 1,
      });
      void runner.start(job);
    },
  });
  toStop.push(n);
  n.conn.start();
  await n.waitFor(() => n.welcomes.length > 0);
  const [row] = await t.db.select().from(nodes).where(eq(nodes.nodeKey, n.address.toLowerCase()));
  const id = (row as typeof nodes.$inferSelect).id;
  await t.db
    .update(nodes)
    .set({ registered: true, onchainId: 55n, stakeSpdl: '1000' })
    .where(eq(nodes.id, id));
  await nodeHub.refreshEligibility(id);
  return { n, id, owner: (row as typeof nodes.$inferSelect).owner };
}

const target = (id: string) => ({ node: { nodeId: id, isHouse: false, engine: 'ollama' }, model: MODEL });

describe('canaries against real N1 job runners', () => {
  test('a lazy node fails 3 canaries: withheld earnings, suspended, slash case, indistinguishable jobs', async () => {
    const { n, id, owner } = await agent(true);
    await t.db
      .insert(earningEvents)
      .values({ ts: new Date(), nodeId: id, owner, kind: 'job', usdgMicros: 7_000_000n });
    canaryDeps.random = () => 0; // fixture 0: "What is 17 + 25?"
    for (let i = 0; i < 3; i++) {
      expect(await sendCanary(target(id))).not.toBeNull();
      await n.waitFor(() => n.jobs.length === i + 1);
    }
    const rows = await t.db.select().from(canaryResults);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.pass)).toBe(true);
    expect(rows[0]?.observed).toMatchObject({ text: 'ok' });

    const [node] = await t.db.select().from(nodes).where(eq(nodes.id, id));
    expect(node?.status).toBe('suspended');
    expect(node?.reputation).toBe(700);
    const net = (await t.db.select().from(earningEvents)).reduce((a, e) => a + e.usdgMicros, 0n);
    expect(net).toBe(0n); // withheld exactly what was earned, never more
    expect(
      (await t.db.select().from(earningEvents)).filter((e) => e.kind === 'canary_withhold'),
    ).toHaveLength(1);
    const [c] = await t.db.select().from(slashCases);
    expect(c?.nodeId).toBe(id);
    expect(c?.reason).toBe('canary_fraud');
    await n.waitFor(() => n.closes.includes(CLOSE_CODES.SUSPENDED), 3000);

    // no money moved: free jobs, no buyer charge, no provider earning
    expect(await t.db.select().from(buyerLedger)).toHaveLength(0);
    const js = await t.db.select().from(jobs);
    expect(
      js.every(
        (j) =>
          j.isCanary && j.payMode === 'canary' && j.buyerUsdgMicros === 0n && j.providerUsdgMicros === 0n,
      ),
    ).toBe(true);

    // what the node saw: exactly the fields of a buyer job.start, and a plain OpenAI chat body
    const m = n.jobs[0] as Record<string, unknown>;
    expect(Object.keys(m).sort()).toEqual(
      [
        'deadlineMs',
        'engineModel',
        'jobId',
        'kind',
        'lane',
        'maxTokens',
        'model',
        'request',
        'type',
        'v',
      ].sort(),
    );
    expect(m.model).toBe('qwen2.5:7b');
    const reqBody = m.request as Record<string, unknown>;
    expect(Object.keys(reqBody).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'seed',
      'stream',
      'temperature',
    ]);
    expect(reqBody.temperature).toBe(0);
    expect(reqBody.seed).toBe(7);
    expect(JSON.stringify(m)).not.toMatch(/canary/i);
    expect(CHAT_FIXTURES[0]?.prompt).toBe((reqBody.messages as { content: string }[])[0]?.content as string);
  });

  test('an honest node passes: reputation up, no case, no earnings change', async () => {
    const { n, id } = await agent(false);
    canaryDeps.random = () => 0;
    expect(await sendCanary(target(id))).not.toBeNull();
    await n.waitFor(() => n.jobs.length === 1);
    const [r] = await t.db.select().from(canaryResults);
    expect(r?.pass).toBe(true);
    const [node] = await t.db.select().from(nodes).where(eq(nodes.id, id));
    expect(node?.reputation).toBe(1002);
    expect(node?.status).not.toBe('suspended');
    expect(await t.db.select().from(slashCases)).toHaveLength(0);
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
  });
});
