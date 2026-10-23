import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import OpenAI from 'openai';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { credit } from '../../db/balances';
import { apiKeys, buyerBalances, buyerLedger, jobs, nodes, rateCard, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { websocket } from '../../lib/ws';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { createApiKey } from '../buyers/apikeys';
import buyerRoutes from '../buyers/routes';
import { buyerIdForAddress } from '../buyers/service';
import { createEnrollment } from '../nodes/enroll';
import { nodeHub } from '../nodes/hub';
import nodesRoutes from '../nodes/routes';
import { nodeSettings, setStakingParamsForTest } from '../nodes/service';
import { type FakeNode, fakeNode } from '../nodes/testing';
import { utcDay } from './pricing';
import gatewayRoutes from './routes';
import { resetTtft } from './scheduler';
import { gatewayDeps, registerJobFinishedHandler, resetJobFinishedHandler } from './service';
import { resetTokenizerCache, tokenizerSettings } from './tokenizer';

let t: TestDb;
let server: ReturnType<typeof Bun.serve>;
let base: string;
const OWNER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const BUYER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
let ownerId: string;
let buyerId: string;
let apiKey: string;
let keyId: string;
const spawned: FakeNode[] = [];
const origDispatch = gatewayDeps.dispatch;

const OUT = (content: string, pt = 5, ct = 2) => ({
  id: 'x',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
});

type JobMsg = Parameters<NonNullable<Parameters<typeof fakeNode>[0]['onJob']>>[1];

/** Node that streams `parts` then finishes. */
const streams =
  (parts: string[], usage = { promptTokens: 5, completionTokens: 2 }) =>
  (node: FakeNode, j: JobMsg) => {
    node.conn.send({ v: 1, type: 'job.accepted', jobId: j.jobId });
    parts.forEach((p, i) =>
      node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: i, delta: { content: p } }),
    );
    node.conn.send({
      v: 1,
      type: 'job.done',
      jobId: j.jobId,
      output: OUT(parts.join(''), usage.promptTokens, usage.completionTokens),
      usage,
      receipt: 'AA==',
    });
  };

const embeds = (node: FakeNode, j: JobMsg) => {
  node.conn.send({ v: 1, type: 'job.accepted', jobId: j.jobId });
  node.conn.send({
    v: 1,
    type: 'job.done',
    jobId: j.jobId,
    output: {
      object: 'list',
      model: 'nomic-embed-text',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 4, total_tokens: 4 },
    },
    usage: { promptTokens: 4, completionTokens: 0 },
    receipt: 'AA==',
  });
};

async function spawnNode(
  over: Partial<Parameters<typeof fakeNode>[0]> = {},
  opts: { staked?: boolean; register?: boolean } = {},
) {
  const { token } = await createEnrollment(ownerId, { engine: 'ollama', os: 'linux', name: 'rig' });
  const n = fakeNode({
    wsUrl: `ws://127.0.0.1:${server.port}`,
    token,
    gpu: { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576 },
    models: ['qwen2.5:7b', 'nomic-embed-text'],
    ...over,
  });
  spawned.push(n);
  n.conn.start();
  await n.waitFor(() => n.welcomes.length > 0);
  const [row] = await t.db.select().from(nodes).where(eq(nodes.nodeKey, n.address.toLowerCase()));
  if (!row) throw new Error('node row missing');
  if (opts.register !== false) {
    await t.db
      .update(nodes)
      .set({
        registered: true,
        onchainId: BigInt(Math.floor(Math.random() * 1e9)),
        ...(opts.staked ? { stakeSpdl: '250' } : {}),
      })
      .where(eq(nodes.id, row.id));
    await nodeHub.refreshEligibility(row.id);
  }
  return { n, id: row.id };
}

const client = (key = apiKey) => new OpenAI({ baseURL: `${base}/v1`, apiKey: key, maxRetries: 0 });
const chatBody = {
  model: 'qwen2.5:7b',
  messages: [{ role: 'user' as const, content: 'hi' }],
  max_tokens: 16,
};

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  key: string | null = apiKey,
) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });

async function balance() {
  const [b] = await t.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, buyerId));
  return { balance: b?.balanceUsdgMicros ?? 0n, reserved: b?.reservedUsdgMicros ?? 0n };
}
async function waitFor(pred: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const lastJob = async () => (await t.db.select().from(jobs))[0];
const settled = async () => (await balance()).reserved === 0n;

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  const app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  nodesRoutes(app);
  buyerRoutes(app);
  gatewayRoutes(app);
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
  base = `http://127.0.0.1:${server.port}`;
  nodeSettings.registry = '0x00000000000000000000000000000000000000b2';
  setStakingParamsForTest({
    token: '0x00000000000000000000000000000000000000c3',
    minStakeByClass: { '0': '0', '1': '100', '2': '200', '3': '300', '4': '400' },
    unstakeDelay: 604800,
  });
  tokenizerSettings.load = async () => {
    throw new Error('offline in tests');
  };
  await nodeHub.start({ redis: false });
});
afterAll(async () => {
  await nodeHub.stop();
  server.stop(true);
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  resetTtft();
  resetTokenizerCache();
  resetJobFinishedHandler();
  gatewayDeps.dispatch = origDispatch;
  const [u] = await t.db.insert(users).values({ address: OWNER }).returning();
  ownerId = u?.id as string;
  buyerId = await buyerIdForAddress(BUYER);
  await credit(t.db, { buyerId, micros: 1_000_000n, txHash: `0x${'1'.repeat(64)}`, logIndex: 0 });
  const created = await createApiKey(buyerId, 'test');
  apiKey = created.key;
  keyId = created.id;
  const day = utcDay();
  await t.db.insert(rateCard).values(
    [
      ['tokens_1m', 1_000_000n, 800_000n],
      ['image', 40_000n, 32_000n],
    ].map(([unitKind, buyer, provider]) => ({
      day,
      gpuClass: 2,
      lane: 'open',
      unitKind: unitKind as string,
      buyerUsdgMicrosPerUnit: buyer as bigint,
      providerUsdgMicrosPerUnit: provider as bigint,
    })),
  );
});
afterEach(async () => {
  for (const n of spawned.splice(0)) n.conn.stop();
  for (let i = 0; i < 100 && nodeHub.onlineNodeIds().length > 0; i++)
    await new Promise((r) => setTimeout(r, 10));
  nodeSettings.jobTimeoutMs = 120_000;
});

describe('admission order', () => {
  test('no capacity -> 503 and nothing is reserved or recorded', async () => {
    const res = await post('/v1/chat/completions', chatBody);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_CAPACITY');
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect(await t.db.select().from(jobs)).toHaveLength(0);
    expect(await t.db.select().from(buyerLedger).where(eq(buyerLedger.kind, 'charge'))).toHaveLength(0);
  });

  test('unregistered node is no capacity', async () => {
    await spawnNode({ onJob: streams(['x']) }, { register: false });
    expect((await post('/v1/chat/completions', chatBody)).status).toBe(503);
  });

  test('insufficient balance -> 402 and no job row', async () => {
    await spawnNode({ onJob: streams(['x']) });
    await t.db.update(buyerBalances).set({ balanceUsdgMicros: 5n }).where(eq(buyerBalances.buyerId, buyerId));
    const res = await post('/v1/chat/completions', chatBody);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await t.db.select().from(jobs)).toHaveLength(0);
    expect((await balance()).reserved).toBe(0n);
  });

  test('401 for missing, unknown and revoked keys; 404 for unknown model; 400 for bad body', async () => {
    expect((await post('/v1/chat/completions', chatBody, {}, null)).status).toBe(401);
    expect((await post('/v1/chat/completions', chatBody, {}, 'sk-spdl-nope')).status).toBe(401);
    await t.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
    expect((await post('/v1/chat/completions', chatBody)).status).toBe(401);
    expect((await post('/v1/chat/completions', { ...chatBody, model: 'nope' })).status).toBe(404);
    expect((await post('/v1/chat/completions', { model: 'qwen2.5:7b' })).status).toBe(400);
    const bad = await post('/v1/chat/completions', { ...chatBody, max_tokens: 99999 });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { message: string; type: string; code: string } };
    expect(body.error.type).toBe('invalid_request_error');
  });

  test('rate limit: 60 requests per minute per key', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await post('/v1/chat/completions', chatBody)).status;
    expect(last).toBe(429);
  });
});

describe('chat', () => {
  test('streams through the openai SDK and settles the exact charge', async () => {
    await spawnNode({ onJob: streams(['he', 'llo']) });
    const { data: stream, response } = await client()
      .chat.completions.create({ ...chatBody, stream: true })
      .withResponse();
    const chunks: OpenAI.Chat.ChatCompletionChunk[] = [];
    let text = '';
    for await (const c of stream) {
      chunks.push(c);
      text += c.choices[0]?.delta?.content ?? '';
    }
    expect(text).toBe('hello');
    const jobId = response.headers.get('x-spindle-job-id') as string;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('x-spindle-receipt')).toBe(`/v1/receipts/${jobId}`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(chunks[0]?.choices[0]?.delta?.role).toBe('assistant');
    const last = chunks.at(-1) as OpenAI.Chat.ChatCompletionChunk & { spindle: Record<string, string> };
    expect(last.choices[0]?.finish_reason).toBe('stop');
    expect(last.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
    expect(last.spindle).toEqual({ jobId, chargeMicros: '7', receiptUrl: `/v1/receipts/${jobId}` });
    // 1 micro per token -> 7 micros
    await waitFor(settled);
    expect(await balance()).toEqual({ balance: 999_993n, reserved: 0n });
    const [ledger] = await t.db.select().from(buyerLedger).where(eq(buyerLedger.kind, 'charge'));
    expect(ledger?.usdgMicros).toBe(-7n);
    expect(ledger?.jobId).toBe(jobId);
    const job = await lastJob();
    expect(job).toMatchObject({
      status: 'completed',
      payMode: 'balance',
      promptTokens: 5,
      completionTokens: 2,
    });
    expect(job?.buyerUsdgMicros).toBe(7n);
    expect(job?.nodeId).not.toBeNull();
  });

  test('non-stream response carries usage, spindle meta and the charge header', async () => {
    await spawnNode({ onJob: streams(['he', 'llo']) });
    const { data, response } = await client().chat.completions.create(chatBody).withResponse();
    expect(data.choices[0]?.message.content).toBe('hello');
    expect(data.usage?.total_tokens).toBe(7);
    const jobId = response.headers.get('x-spindle-job-id');
    expect((data as unknown as { spindle: { jobId: string; chargeMicros: string } }).spindle).toMatchObject({
      jobId,
      chargeMicros: '7',
    });
    expect(response.headers.get('x-spindle-charge-micros')).toBe('7');
    await waitFor(settled);
    expect((await balance()).balance).toBe(999_993n);
  });

  test('B7 hook receives the done message and the gateway view', async () => {
    const calls: {
      jobId: string;
      view: import('../../shared/contracts/jobs').GatewayView;
      usage: unknown;
    }[] = [];
    registerJobFinishedHandler(async (jobId, done, view) => {
      calls.push({ jobId, view, usage: done.usage });
    });
    await spawnNode({ onJob: streams(['he', 'llo']) });
    await client().chat.completions.create({ ...chatBody, temperature: 0 });
    await waitFor(async () => calls.length === 1);
    const call = calls[0];
    expect(call?.view.outputText).toBe('hello');
    expect(call?.view.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(call?.view.recount?.completionTokens).toBeGreaterThan(0);
    expect(call?.usage).toEqual({ promptTokens: 5, completionTokens: 2 });
    // the hook owns settlement now: the reservation is still held until it settles
    expect((await balance()).reserved).toBeGreaterThan(0n);
    const { settleJob } = await import('./service');
    expect(await settleJob(call?.jobId as string, 3n)).toBe(3n);
    expect(await settleJob(call?.jobId as string, 3n)).toBeNull(); // idempotent
    expect(await balance()).toEqual({ balance: 999_997n, reserved: 0n });
  });

  test('a failing B7 hook releases the reservation', async () => {
    registerJobFinishedHandler(async () => {
      throw new Error('verifier exploded');
    });
    await spawnNode({ onJob: streams(['ok']) });
    await client().chat.completions.create(chatBody);
    await waitFor(settled);
    expect((await balance()).balance).toBe(1_000_000n);
  });

  test('node lost before the first byte -> retried once on another node', async () => {
    const a = await spawnNode({ onJob: (node) => node.conn.stop(), noReconnect: true }, { staked: true });
    await spawnNode({ onJob: streams(['from-b']) });
    const res = await client().chat.completions.create(chatBody);
    expect(res.choices[0]?.message.content).toBe('from-b');
    const job = await lastJob();
    expect(job?.nodeId).not.toBe(a.id);
    expect(job?.status).toBe('completed');
    await waitFor(settled);
  });

  test('BUSY before the first byte -> retried on the next node', async () => {
    const busy = (node: FakeNode, j: JobMsg) =>
      node.conn.send({ v: 1, type: 'job.error', jobId: j.jobId, code: 'BUSY', message: 'busy' });
    await spawnNode({ onJob: busy }, { staked: true });
    await spawnNode({ onJob: streams(['ok']) });
    expect((await client().chat.completions.create(chatBody)).choices[0]?.message.content).toBe('ok');
    await waitFor(settled);
  });

  test('both nodes BUSY -> 503 and the reservation is released', async () => {
    const busy = (node: FakeNode, j: JobMsg) =>
      node.conn.send({ v: 1, type: 'job.error', jobId: j.jobId, code: 'BUSY', message: 'busy' });
    await spawnNode({ onJob: busy }, { staked: true });
    await spawnNode({ onJob: busy });
    const res = await post('/v1/chat/completions', chatBody);
    expect(res.status).toBe(503);
    expect((await balance()).reserved).toBe(0n);
    expect((await lastJob())?.status).toBe('failed');
  });
});

describe('release on every failure path', () => {
  test('dispatch refused (AppError) -> 503, reservation released, job failed', async () => {
    await spawnNode({ onJob: streams(['x']) });
    gatewayDeps.dispatch = () => {
      throw new AppError('NO_CAPACITY', 'Node is not online.');
    };
    const res = await post('/v1/chat/completions', chatBody);
    expect(res.status).toBe(503);
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect((await lastJob())?.status).toBe('failed');
  });

  test('unexpected exception -> 500, reservation released', async () => {
    await spawnNode({ onJob: streams(['x']) });
    gatewayDeps.dispatch = () => {
      throw new Error('boom');
    };
    const res = await post('/v1/chat/completions', chatBody);
    expect(res.status).toBe(500);
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect((await lastJob())?.status).toBe('failed');
  });

  test('node timeout -> 504, reservation released, job timeout', async () => {
    nodeSettings.jobTimeoutMs = 200;
    await spawnNode({ onJob: () => {} });
    const res = await post('/v1/chat/completions', chatBody);
    expect(res.status).toBe(504);
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect((await lastJob())?.status).toBe('timeout');
  });

  test('node error after the first chunk (stream) -> error frame, released, nothing charged', async () => {
    await spawnNode({
      onJob: (node, j) => {
        node.conn.send({ v: 1, type: 'job.accepted', jobId: j.jobId });
        node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 0, delta: { content: 'par' } });
        node.conn.send({ v: 1, type: 'job.error', jobId: j.jobId, code: 'ENGINE_ERROR', message: 'oom' });
      },
    });
    const res = await post('/v1/chat/completions', { ...chatBody, stream: true });
    const text = await res.text();
    expect(text).toContain('"par"');
    expect(text).toContain('"error"');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
    await waitFor(settled);
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect((await lastJob())?.status).toBe('failed');
  });

  test('client abort mid-stream -> job cancelled, partial charge for produced tokens, rest released', async () => {
    const text = 'x'.repeat(30); // chars/3 estimate -> 10 completion tokens
    await spawnNode({
      onJob: (node, j) => {
        node.conn.send({ v: 1, type: 'job.accepted', jobId: j.jobId });
        node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 0, delta: { content: text } });
      },
    });
    const ctrl = new AbortController();
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...chatBody, stream: true }),
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    let seen = '';
    while (!seen.includes('xxxx')) seen += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    await reader.cancel().catch(() => {});
    await waitFor(settled);
    const job = await lastJob();
    expect(job?.status).toBe('cancelled');
    // prompt (3 est.) + completion (10 est.) = 13 micros at 1 micro/token
    expect(job?.buyerUsdgMicros).toBe(13n);
    expect(await balance()).toEqual({ balance: 1_000_000n - 13n, reserved: 0n });
    await waitFor(async () => (nodeHub.getSession(job?.nodeId as string)?.inflight.size ?? 0) === 0);
  });

  test('non-stream client abort -> partial charge and cancelled', async () => {
    await spawnNode({
      onJob: (node, j) => {
        node.conn.send({ v: 1, type: 'job.accepted', jobId: j.jobId });
        node.conn.send({ v: 1, type: 'job.chunk', jobId: j.jobId, seq: 0, delta: { content: 'abcdef' } });
      },
    });
    const ctrl = new AbortController();
    const p = fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(chatBody),
    }).catch(() => null);
    await waitFor(async () => (await lastJob())?.status === 'running');
    await new Promise((r) => setTimeout(r, 100));
    ctrl.abort();
    await p;
    await waitFor(async () => (await lastJob())?.status === 'cancelled');
    await waitFor(settled);
    expect((await lastJob())?.buyerUsdgMicros).toBe(5n); // 3 prompt + 2 completion (estimated)
  });
});

describe('embeddings, models, auth', () => {
  test('embeddings via the SDK', async () => {
    await spawnNode({ onJob: embeds });
    const { data, response } = await client()
      .embeddings.create({ model: 'nomic-embed-text', input: 'hello world' })
      .withResponse();
    expect(data.data[0]?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(data.usage.prompt_tokens).toBe(4);
    expect(response.headers.get('x-spindle-charge-micros')).toBe('4');
    await waitFor(settled);
    const job = await lastJob();
    expect(job).toMatchObject({ kind: 'embeddings', status: 'completed', promptTokens: 4 });
  });

  test('GET /v1/models lists models with an online node', async () => {
    expect(((await (await fetch(`${base}/v1/models`)).json()) as { data: unknown[] }).data).toHaveLength(0);
    await spawnNode({ onJob: streams(['x']) });
    const res = (await (await fetch(`${base}/v1/models`)).json()) as {
      object: string;
      data: { id: string; available: boolean; pricing: { unitKind: string; buyerMicrosPerUnit: string } }[];
    };
    expect(res.object).toBe('list');
    const m = res.data.find((d) => d.id === 'qwen2.5:7b');
    expect(m).toMatchObject({
      available: true,
      pricing: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '1000000' },
    });
  });

  test('dashboard cookie + x-spindle-pay: balance enforces CSRF and the session', async () => {
    await spawnNode({ onJob: streams(['hi']) });
    const s = await createTestSession(BUYER);
    const origin = 'http://localhost:7300';
    settings.corsOrigins.push(origin);
    const noCsrf = await post(
      '/v1/chat/completions',
      chatBody,
      { cookie: s.cookie, 'x-spindle-pay': 'balance' },
      null,
    );
    expect(noCsrf.status).toBe(403);
    expect(await t.db.select().from(jobs)).toHaveLength(0);
    const ok = await post(
      '/v1/chat/completions',
      chatBody,
      { cookie: s.cookie, 'x-spindle': '1', origin, 'x-spindle-pay': 'balance' },
      null,
    );
    expect(ok.status).toBe(200);
    await waitFor(settled);
    expect((await balance()).balance).toBe(999_993n);
    const anon = await post(
      '/v1/chat/completions',
      chatBody,
      { 'x-spindle': '1', origin, 'x-spindle-pay': 'balance' },
      null,
    );
    expect(anon.status).toBe(401);
  });

  test('x402 is a registered hook: no credentials -> 401 until B10 registers a provider', async () => {
    await spawnNode({ onJob: streams(['x']) });
    expect((await post('/v1/chat/completions', chatBody, {}, null)).status).toBe(401);
    const { registerPaymentProvider, unregisterPaymentProvider } = await import('./payment');
    registerPaymentProvider('x402', {
      name: 'x402',
      handles: () => true,
      authorize: async () => ({
        challenge: true,
        status: 402,
        headers: { 'payment-required': 'abc' },
        body: { x402Version: 2 },
      }),
      finalize: async () => 0n,
      release: async () => {},
    });
    try {
      const res = await post('/v1/chat/completions', chatBody, {}, null);
      expect(res.status).toBe(402);
      expect(res.headers.get('payment-required')).toBe('abc');
      expect(await t.db.select().from(jobs)).toHaveLength(0);
    } finally {
      unregisterPaymentProvider('x402');
    }
  });
});
