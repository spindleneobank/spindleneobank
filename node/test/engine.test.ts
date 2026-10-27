import { afterEach, expect, test } from 'bun:test';
import { loadConfig } from '../src/config';
import { OllamaEngine } from '../src/engine/ollama';
import { parseSseLine } from '../src/engine/openai';

let srv: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => srv?.stop(true));

test('parseSseLine handles content, reasoning, usage, DONE', () => {
  expect(parseSseLine('data: {"choices":[{"delta":{"content":"hi"}}]}')).toEqual({ content: 'hi' });
  expect(parseSseLine('data: {"choices":[{"delta":{"reasoning":"hm"}}]}')).toEqual({ reasoning: 'hm' });
  expect(parseSseLine('data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}')).toEqual({
    usage: { promptTokens: 2, completionTokens: 3 },
  });
  expect(parseSseLine('data: [DONE]')).toBeNull();
  expect(parseSseLine('garbage')).toBeNull();
});

function ollamaServer(onChat: (body: Record<string, unknown>) => void, showCtx: number | null = 32768) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === '/api/tags')
        return Response.json({ models: [{ name: 'q:1', digest: 'sha256:x', size: 2097152 }] });
      if (u.pathname === '/api/show')
        return Response.json(showCtx ? { model_info: { 'qwen2.context_length': showCtx } } : {});
      if (u.pathname === '/api/chat') {
        onChat((await req.json()) as Record<string, unknown>);
        return new Response(
          '{"message":{"content":"a"},"done":false}\n{"message":{"content":"b"},"done":false}\n{"message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":11,"eval_count":2}\n',
        );
      }
      return new Response('no', { status: 404 });
    },
  });
}

test('ollama engine streams native chat with usage and lists models', async () => {
  srv = ollamaServer(() => {});
  const e = new OllamaEngine(`http://127.0.0.1:${srv.port}`);
  expect(await e.listModels()).toEqual([{ id: 'q:1', digest: 'sha256:x', sizeMb: 2 }]);
  let out = '';
  let usage: unknown;
  for await (const d of e.chatStream({ model: 'q:1', messages: [] })) {
    out += d.content ?? '';
    if (d.usage) usage = d.usage;
  }
  expect(out).toBe('ab');
  expect(usage).toEqual({ promptTokens: 11, completionTokens: 2 });
});

test('ollama engine sends options.num_ctx (model window capped by SPINDLE_NUM_CTX) on every chat', async () => {
  const seen: Record<string, unknown>[] = [];
  srv = ollamaServer((b) => seen.push(b));
  const e = new OllamaEngine(`http://127.0.0.1:${srv.port}`, 8192);
  expect(await e.contextLength('q:1')).toBe(8192);
  for await (const _ of e.chatStream({
    model: 'q:1',
    max_tokens: 50,
    temperature: 0.2,
    stop: 'x',
    messages: [{ role: 'user', content: 'hi' }],
  })) {
  }
  expect(seen[0]?.options).toEqual({ num_ctx: 8192, num_predict: 50, temperature: 0.2, stop: ['x'] });
  const e2 = new OllamaEngine(`http://127.0.0.1:${srv.port}`, 65536);
  expect(await e2.contextLength('q:1')).toBe(32768);
});

test('ollama engine falls back to 4096 when /api/show has no context length', async () => {
  srv = ollamaServer(() => {}, null);
  expect(await new OllamaEngine(`http://127.0.0.1:${srv.port}`, 8192).contextLength('q:1')).toBe(4096);
});

test('config refuses dev flags on a public host', () => {
  const base = { SPINDLE_API_URL: 'wss://api.spindle.example' };
  expect(() => loadConfig({ ...base, SPINDLE_DEV_LAZY: '1' })).toThrow(/refused/);
  expect(() => loadConfig({ ...base, SPINDLE_DEV_FAKE_GPU: 'RTX 4090:24576' })).toThrow(/refused/);
  expect(loadConfig({ SPINDLE_API_URL: 'ws://api:3000', SPINDLE_DEV_LAZY: '1' }).devLazy).toBe(true);
  expect(
    loadConfig({ SPINDLE_API_URL: 'ws://localhost:7000', SPINDLE_DEV_FAKE_GPU: 'RTX 4090:24576' }).devFakeGpu,
  ).toEqual({
    name: 'RTX 4090',
    vramMb: 24576,
  });
  expect(loadConfig(base).devLazy).toBe(false);
  expect(loadConfig(base).engineUrl).toBe('http://127.0.0.1:11434');
});
