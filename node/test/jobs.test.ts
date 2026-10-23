import { describe, expect, test } from 'bun:test';
import type { JobStartMsg, NodeToServer } from '@spindle/shared/node-protocol';
import { decodeReceipt, receiptFromBase64, verifyReceipt } from '@spindle/shared/receipt';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Delta, Engine } from '../src/engine';
import { JobRunner } from '../src/jobs';
import { silentLogger } from '../src/log';

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
const key = { privateKey: pk, address: account.address, publicKey: account.publicKey, createdAt: '', account };

function fakeEngine(deltas: (Delta & { wait?: number })[], opts: { usage?: boolean } = {}): Engine {
  return {
    kind: 'ollama',
    listModels: async () => [{ id: 'q', digest: 'sha256:dd', sizeMb: 1 }],
    ensureModel: async () => 'sha256:dd',
    async *chatStream(_r, signal) {
      for (const d of deltas) {
        if (d.wait) await new Promise((r) => setTimeout(r, d.wait));
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield d;
      }
      if (opts.usage !== false) yield { usage: { promptTokens: 5, completionTokens: deltas.length } };
    },
    chat: async () => ({}),
    embeddings: async () => ({
      data: [
        { index: 1, embedding: [3, 4] },
        { index: 0, embedding: [1, 2] },
      ],
      usage: { prompt_tokens: 7 },
    }),
    version: async () => '1',
  };
}

const mkJob = (over: Partial<JobStartMsg> = {}): JobStartMsg => ({
  v: 1,
  type: 'job.start',
  jobId: 'job1',
  kind: 'chat',
  model: 'qwen',
  engineModel: 'q',
  lane: 'open',
  request: { messages: [{ role: 'user', content: 'hi' }], stream: true },
  maxTokens: 100,
  deadlineMs: 30_000,
  ...over,
});

function setup(engine: Engine, lazy = false) {
  const sent: NodeToServer[] = [];
  const times: number[] = [];
  const runner = new JobRunner({
    engine,
    key,
    log: silentLogger,
    agentVersion: '0.1.0',
    lazy,
    send: (m) => {
      sent.push(m);
      times.push(performance.now());
      return true;
    },
  });
  return { runner, sent, times };
}

describe('jobs', () => {
  test('streams 3 deltas as batched chunks then done with verifiable receipt', async () => {
    const { runner, sent, times } = setup(
      fakeEngine([
        { content: 'a' },
        { content: 'b', wait: 40 },
        { content: 'c', wait: 40 },
      ]),
    );
    await runner.start(mkJob());
    expect(sent[0]?.type).toBe('job.accepted');
    const chunks = sent.filter((m) => m.type === 'job.chunk');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const seqs = chunks.map((c) => (c as { seq: number }).seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const text = chunks.map((c) => (c as { delta: { content?: string } }).delta.content ?? '').join('');
    expect(text).toBe('abc');
    const idx = sent.map((m, i) => (m.type === 'job.chunk' ? i : -1)).filter((i) => i >= 0);
    for (let i = 1; i < idx.length; i++) expect((times[idx[i] as number] ?? 0) - (times[idx[i - 1] as number] ?? 0)).toBeGreaterThanOrEqual(20);
    const done = sent.at(-1) as Extract<NodeToServer, { type: 'job.done' }>;
    expect(done.type).toBe('job.done');
    expect(done.usage).toEqual({ promptTokens: 5, completionTokens: 3 });
    expect((done.output as { choices: { message: { content: string } }[] }).choices[0]?.message.content).toBe('abc');
    const cose = receiptFromBase64(done.receipt);
    expect(verifyReceipt(cose, account.publicKey)).toBe(true);
    const p = decodeReceipt(cose).payload;
    expect(p.jobId).toBe('job1');
    expect(p.modelDigest).toBe('sha256:dd');
    expect(runner.busy).toBe(false);
  });

  test('rapid deltas collapse into one chunk', async () => {
    const { runner, sent } = setup(fakeEngine([{ content: 'a' }, { content: 'b' }, { content: 'c' }]));
    await runner.start(mkJob());
    const chunks = sent.filter((m) => m.type === 'job.chunk');
    expect(chunks).toHaveLength(1);
  });

  test('missing usage falls back to chunk count', async () => {
    const { runner, sent } = setup(fakeEngine([{ content: 'a' }, { content: 'b' }], { usage: false }));
    await runner.start(mkJob());
    expect((sent.at(-1) as { usage: unknown }).usage).toEqual({ promptTokens: 0, completionTokens: 2 });
  });

  test('cancel mid-stream aborts without done/error', async () => {
    const { runner, sent } = setup(fakeEngine([{ content: 'a' }, { content: 'b', wait: 200 }, { content: 'c' }]));
    const p = runner.start(mkJob());
    await Bun.sleep(60);
    runner.cancel('job1');
    await p;
    expect(sent.some((m) => m.type === 'job.done' || m.type === 'job.error')).toBe(false);
    expect(runner.busy).toBe(false);
  });

  test('second job gets BUSY', async () => {
    const { runner, sent } = setup(fakeEngine([{ content: 'a', wait: 100 }]));
    const p = runner.start(mkJob());
    await runner.start(mkJob({ jobId: 'job2' }));
    const busy = sent.find((m) => m.type === 'job.error') as { jobId: string; code: string };
    expect(busy).toMatchObject({ jobId: 'job2', code: 'BUSY' });
    await p;
    expect(sent.at(-1)?.type).toBe('job.done');
  });

  test('unknown model -> MODEL_NOT_READY', async () => {
    const { runner, sent } = setup(fakeEngine([]));
    await runner.start(mkJob({ engineModel: 'nope' }));
    expect(sent.at(-1)).toMatchObject({ type: 'job.error', code: 'MODEL_NOT_READY' });
  });

  test('engine failure -> ENGINE_ERROR, timeout -> TIMEOUT', async () => {
    const bad = fakeEngine([]);
    bad.chatStream = () => {
      throw new Error('boom');
    };
    const a = setup(bad);
    await a.runner.start(mkJob());
    expect(a.sent.at(-1)).toMatchObject({ code: 'ENGINE_ERROR' });
    const b = setup(fakeEngine([{ content: 'a', wait: 300 }]));
    await b.runner.start(mkJob({ deadlineMs: 50 }));
    expect(b.sent.at(-1)).toMatchObject({ code: 'TIMEOUT' });
  });

  test('lazy mode returns "ok" without engine', async () => {
    const e = fakeEngine([{ content: 'real' }]);
    e.listModels = async () => {
      throw new Error('engine down');
    };
    e.chatStream = () => {
      throw new Error('must not be called');
    };
    const { runner, sent } = setup(e, true);
    await runner.start(mkJob());
    const done = sent.at(-1) as Extract<NodeToServer, { type: 'job.done' }>;
    expect(done.type).toBe('job.done');
    expect((done.output as { choices: { message: { content: string } }[] }).choices[0]?.message.content).toBe('ok');
    expect(verifyReceipt(receiptFromBase64(done.receipt), account.publicKey)).toBe(true);
  });

  test('embeddings: ordered by index, no chunks, verifiable receipt', async () => {
    const { runner, sent } = setup(fakeEngine([]));
    await runner.start(mkJob({ kind: 'embeddings', request: { input: ['a', 'b'] } }));
    expect(sent.some((m) => m.type === 'job.chunk')).toBe(false);
    const done = sent.at(-1) as Extract<NodeToServer, { type: 'job.done' }>;
    expect(done.usage).toEqual({ promptTokens: 7, completionTokens: 0 });
    const p = decodeReceipt(receiptFromBase64(done.receipt)).payload;
    const buf = new DataView(new ArrayBuffer(16));
    [1, 2, 3, 4].forEach((n, i) => buf.setFloat32(i * 4, n, true));
    expect(p.outputDigest).toBe(new Bun.CryptoHasher('sha256').update(new Uint8Array(buf.buffer)).digest('hex'));
  });
});
