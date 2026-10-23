import { expect, test } from 'bun:test';
import type { NodeToServer, ProbeStartMsg } from '@spindle/shared/node-protocol';
import { BENCH_MAX_TOKENS, BENCH_TEMPERATURE, runBenchmark } from '../src/bench';
import type { Delta, Engine } from '../src/engine';
import { silentLogger } from '../src/log';
import { ProbeRunner } from '../src/probes';

function engine(seen: Record<string, unknown>[] = [], fail = false): Engine {
  return {
    kind: 'ollama',
    listModels: async () => [{ id: 'q:1', digest: 'sha256:abc', sizeMb: 1 }],
    ensureModel: async () => 'sha256:abc',
    async *chatStream(req): AsyncGenerator<Delta> {
      seen.push(req);
      if (fail) throw new Error('engine down');
      await new Promise((r) => setTimeout(r, 20));
      yield { content: 'a' };
      await new Promise((r) => setTimeout(r, 100));
      for (let i = 0; i < 50; i++) yield { content: 'b' };
      yield { usage: { promptTokens: 60, completionTokens: 51 } };
    },
    chat: async () => ({}),
    embeddings: async () => ({}),
    version: async () => '0',
  };
}

const probe = (id: string, kind: 'hardware' | 'bench'): ProbeStartMsg => ({
  v: 1,
  type: 'probe.start',
  probeId: id,
  kind,
  params: { model: 'q:1', prompt: 'IGNORED', maxTokens: 5 },
});

test('benchmark uses fixed params and reports ttft, tok/s, digest', async () => {
  const seen: Record<string, unknown>[] = [];
  const r = await runBenchmark(engine(seen), 'q:1');
  expect(seen[0]?.max_tokens).toBe(BENCH_MAX_TOKENS);
  expect(seen[0]?.temperature).toBe(BENCH_TEMPERATURE);
  expect(JSON.stringify(seen[0])).not.toContain('IGNORED');
  expect(r.digest).toBe('sha256:abc');
  expect(r.ttftMs).toBeGreaterThanOrEqual(15);
  expect(r.tokPerSec).toBeGreaterThan(0);
});

test('probes queue behind a running job and run one at a time', async () => {
  const out: NodeToServer[] = [];
  let busy = true;
  let release!: () => void;
  const jobDone = new Promise<void>((r) => {
    release = () => {
      busy = false;
      r();
    };
  });
  const p = new ProbeRunner({
    engine: engine(),
    send: (m) => !!out.push(m),
    log: silentLogger,
    idle: () => jobDone,
    busy: () => busy,
    hardware: async () => ({ gpus: [], cpu: 'x', ramMb: 1 }),
  });
  const a = p.handle(probe('p1', 'hardware'));
  const b = p.handle(probe('p2', 'bench'));
  await Bun.sleep(50);
  expect(out.length).toBe(0);
  release();
  await Promise.all([a, b]);
  expect(out.map((m) => (m as { probeId: string }).probeId)).toEqual(['p1', 'p2']);
  expect((out[0] as { hardware?: unknown }).hardware).toBeDefined();
  expect((out[1] as { bench?: { model: string } }).bench?.model).toBe('q:1');
});

test('a failing bench still answers with an empty probe.result', async () => {
  const out: NodeToServer[] = [];
  const p = new ProbeRunner({
    engine: engine([], true),
    send: (m) => !!out.push(m),
    log: silentLogger,
    idle: async () => {},
    busy: () => false,
  });
  await p.handle(probe('p3', 'bench'));
  expect(out).toEqual([{ v: 1, type: 'probe.result', probeId: 'p3' }]);
});
