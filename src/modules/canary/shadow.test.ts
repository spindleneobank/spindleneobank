import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { canaryResults, jobs, nodes, receipts } from '../../db/schema';
import { getQueue } from '../../lib/queue';
import { closeRedis } from '../../lib/redis';
import { DEFAULT_CATALOG } from '../../shared/catalog';
import { dbRef } from '../auth/constants';
import type { Delta, JobDone } from '../nodes/jobs';
import { makeCanaryJob, makeNode } from '../slashing/testkit';
import { canaryDeps, compareChatWithHouse, compareSettings } from './compare';
import { maybeEnqueueShadow, type ShadowCheck, shadowSettings } from './shadow';
import { runShadowCheck } from './shadow-job';

const CHAT = DEFAULT_CATALOG.find((m) => m.id === 'qwen2.5:0.5b') as (typeof DEFAULT_CATALOG)[number];
const body = { model: CHAT.id, messages: [{ role: 'user', content: 'q' }], stream: true, max_tokens: 900 };

let t: TestDb;
const real = { ...canaryDeps };
/** Texts the fake house answers with, in order; embeddings are looked up per text. */
let houseAnswers: string[];
let vectors: Record<string, number[]>;
let sentToHouse: { maxTokens: number; request: Record<string, unknown> }[];

function fakeHouse(hasHouse = true) {
  canaryDeps.candidates = async () =>
    hasHouse ? [{ nodeId: 'house', isHouse: true, engine: 'ollama' }] : [];
  canaryDeps.dispatch = async (_id, job, onChunk: (d: Delta) => void): Promise<JobDone> => {
    if (job.kind === 'chat') {
      sentToHouse.push({ maxTokens: job.maxTokens, request: job.request as Record<string, unknown> });
      onChunk({ seq: 0, delta: { content: houseAnswers.shift() ?? '' } });
      return { output: {}, usage: { promptTokens: 1, completionTokens: 1 }, receipt: '' };
    }
    const input = (job.request as { input: string[] }).input;
    return {
      output: { data: input.map((text) => ({ embedding: vectors[text] ?? [0, 0, 1] })) },
      usage: { promptTokens: 1, completionTokens: 0 },
      receipt: '',
    };
  };
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
  sentToHouse = [];
  vectors = { 'house a': [1, 0, 0], 'house b': [0.99, 0.1, 0], honest: [0.98, 0.15, 0], garbage: [0, 1, 0] };
  houseAnswers = ['house a', 'house b'];
  fakeHouse();
});
afterEach(() => {
  Object.assign(canaryDeps, real);
});

describe('compareChatWithHouse', () => {
  test('an answer close to the house answer matches, and the replay is capped', async () => {
    const r = await compareChatWithHouse(CHAT, body, 'honest');
    expect(r.verdict).toBe('match');
    expect(sentToHouse).toHaveLength(2);
    expect(sentToHouse[0]?.maxTokens).toBe(compareSettings.houseMaxTokens);
    expect(sentToHouse[0]?.request.max_tokens).toBe(compareSettings.houseMaxTokens);
  });
  test('an unrelated answer mismatches, and so does an empty one', async () => {
    expect((await compareChatWithHouse(CHAT, body, 'garbage')).verdict).toBe('mismatch');
    houseAnswers = ['house a', 'house b'];
    expect((await compareChatWithHouse(CHAT, body, '  ')).verdict).toBe('mismatch');
  });
  test('when two honest runs disagree the prompt is too open to judge', async () => {
    vectors['house b'] = [0, 1, 0];
    expect(await compareChatWithHouse(CHAT, body, 'garbage')).toEqual({
      verdict: 'inconclusive',
      reason: 'prompt too open to judge',
    });
  });
  test('no house node, an empty house answer or a house failure is inconclusive, never a failure', async () => {
    fakeHouse(false);
    expect((await compareChatWithHouse(CHAT, body, 'garbage')).verdict).toBe('inconclusive');
    fakeHouse();
    houseAnswers = ['', ''];
    expect((await compareChatWithHouse(CHAT, body, 'garbage')).verdict).toBe('inconclusive');
    canaryDeps.dispatch = async () => {
      throw new Error('BUSY');
    };
    expect((await compareChatWithHouse(CHAT, body, 'garbage')).verdict).toBe('inconclusive');
  });
});

describe('runShadowCheck', () => {
  async function paidJob(opts: { verified?: boolean; charged?: bigint; isHouse?: boolean } = {}) {
    const n = await makeNode(opts.isHouse ? { isHouse: true, gpuClass: 0 } : {});
    const jobId = await makeCanaryJob(n.id);
    await t.db
      .update(jobs)
      .set({ isCanary: false, status: 'completed', buyerUsdgMicros: opts.charged ?? 1000n })
      .where(eq(jobs.id, jobId));
    await t.db.insert(receipts).values({
      jobId,
      nodeId: n.id,
      cose: new Uint8Array(0),
      payload: {},
      verified: opts.verified ?? true,
    });
    return { nodeId: n.id, jobId };
  }
  const chat = (ids: { nodeId: string; jobId: string }, outputText: string): ShadowCheck => ({
    ...ids,
    model: CHAT.id,
    kind: 'chat',
    body,
    outputText,
  });

  test('a mismatch counts as a failed canary, and stores no buyer text', async () => {
    const ids = await paidJob();
    expect(await runShadowCheck(chat(ids, 'garbage'))).toBe('mismatch');
    const [r] = await t.db.select().from(canaryResults);
    expect(r?.pass).toBe(false);
    expect(r?.kind).toBe('shadow');
    expect(r?.jobId).toBe(ids.jobId);
    expect(JSON.stringify([r?.expected, r?.observed])).not.toContain('garbage');
  });
  test('a match counts as a pass', async () => {
    const ids = await paidJob();
    expect(await runShadowCheck(chat(ids, 'honest'))).toBe('match');
    const [r] = await t.db.select().from(canaryResults);
    expect(r?.pass).toBe(true);
    const [n] = await t.db.select().from(nodes).where(eq(nodes.id, ids.nodeId));
    expect(n?.reputation).toBe(1002);
  });
  test('inconclusive records nothing', async () => {
    fakeHouse(false);
    expect(await runShadowCheck(chat(await paidJob(), 'garbage'))).toBe('inconclusive');
    expect(await t.db.select().from(canaryResults)).toHaveLength(0);
  });
  test('embeddings are compared with vectors from the house', async () => {
    const ids = await paidJob();
    vectors.input = [1, 0, 0];
    const check: ShadowCheck = {
      ...ids,
      model: 'nomic-embed-text',
      kind: 'embeddings',
      body: { model: 'nomic-embed-text', input: 'input' },
      embeddings: [[0, 1, 0]],
    };
    expect(await runShadowCheck(check)).toBe('mismatch');
    expect(await runShadowCheck({ ...check, embeddings: [[1, 0, 0]] })).toBe('match');
  });
  test('unpaid, house-served, unverified or unknown jobs are skipped', async () => {
    expect(await runShadowCheck(chat(await paidJob({ charged: 0n }), 'garbage'))).toBe('skipped');
    expect(await runShadowCheck(chat(await paidJob({ isHouse: true }), 'garbage'))).toBe('skipped');
    expect(await runShadowCheck(chat(await paidJob({ verified: false }), 'garbage'))).toBe('skipped');
    expect(await runShadowCheck(chat({ nodeId: 'x', jobId: crypto.randomUUID() }, 'garbage'))).toBe(
      'skipped',
    );
    expect(sentToHouse).toHaveLength(0);
  });
});

describe('sampling', () => {
  const check: ShadowCheck = { jobId: 'j', nodeId: 'n', model: 'm', kind: 'chat', body: {}, outputText: 'x' };
  const realSettings = { ...shadowSettings };
  afterEach(async () => {
    Object.assign(shadowSettings, realSettings);
    await getQueue('canary').obliterate({ force: true });
  });
  test('honours the rate, never samples the sealed lane or the house, and bounds the queue and size', async () => {
    shadowSettings.rateBps = 0;
    expect(await maybeEnqueueShadow(check, 'open', false)).toBe(false);
    shadowSettings.rateBps = 10_000;
    expect(await maybeEnqueueShadow(check, 'sealed', false)).toBe(false);
    expect(await maybeEnqueueShadow(check, 'open', true)).toBe(false);
    expect(await maybeEnqueueShadow(check, 'open', false)).toBe(true);
    shadowSettings.maxWaiting = 1;
    expect(await maybeEnqueueShadow(check, 'open', false)).toBe(false);
    shadowSettings.maxWaiting = 20;
    shadowSettings.maxPayloadBytes = 10;
    expect(await maybeEnqueueShadow(check, 'open', false)).toBe(false);
  });
});
