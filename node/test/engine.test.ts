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

test('ollama engine streams SSE and lists models', async () => {
  srv = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === '/api/tags')
        return Response.json({ models: [{ name: 'q:1', digest: 'sha256:x', size: 2097152 }] });
      if (u.pathname === '/v1/chat/completions')
        return new Response(
          'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}],"usage":null}\n\ndata: [DONE]\n\n',
        );
      return new Response('no', { status: 404 });
    },
  });
  const e = new OllamaEngine(`http://127.0.0.1:${srv.port}`);
  expect(await e.listModels()).toEqual([{ id: 'q:1', digest: 'sha256:x', sizeMb: 2 }]);
  let out = '';
  for await (const d of e.chatStream({ model: 'q:1', messages: [] })) out += d.content ?? '';
  expect(out).toBe('ab');
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
