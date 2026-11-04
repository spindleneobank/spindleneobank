import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activeCorpus,
  type BuyerShape,
  type CorpusPrompt,
  corpusSettings,
  drawChatCanary,
  drawEmbeddingInputs,
  parseCorpus,
  priorShape,
} from './corpus';

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0; // mulberry32
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const prompt = (user: string, system?: string): CorpusPrompt =>
  parseCorpus(
    JSON.stringify({
      type: 'prompt',
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
    }),
  ).prompts[0] as CorpusPrompt;

describe('corpus file', () => {
  const realPath = corpusSettings.path;
  afterAll(() => {
    corpusSettings.path = realPath;
  });

  test('parses all entry kinds and hashes prompts instead of keeping an id in the clear', () => {
    const c = parseCorpus(
      [
        '{"type":"prompt","messages":[{"role":"user","content":"secret question"}]}',
        '{"type":"prompt","messages":[{"role":"user","content":"known"}],"expect":{"anyOf":["a"]}}',
        '{"type":"system","text":"sys"}',
        '',
        '{"type":"embedding","text":"emb"}',
      ].join('\n'),
    );
    expect(c.prompts).toHaveLength(2);
    expect(c.prompts[1]?.expect).toEqual({ anyOf: ['a'] });
    expect(c.systems).toEqual(['sys']);
    expect(c.embeddings).toEqual(['emb']);
    expect(c.prompts[0]?.id).not.toContain('secret');
  });

  test('errors name the line and never echo corpus text', () => {
    expect(() => parseCorpus('{"type":"prompt","messages":[]}')).toThrow('line 1');
    let message = '';
    try {
      parseCorpus('{"type":"system","text":"ok"}\nprivate words');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('line 2');
    expect(message).not.toContain('private');
    expect(() =>
      parseCorpus('{"type":"prompt","messages":[{"role":"user","content":"x"}],"expect":{"regex":"("}}'),
    ).toThrow();
  });

  test('no path or an unreadable file gives no corpus rather than a built-in fallback', () => {
    corpusSettings.path = '';
    expect(activeCorpus()).toBeNull();
    corpusSettings.path = '/nonexistent/corpus.jsonl';
    expect(activeCorpus()).toBeNull();
  });

  test('a changed file is picked up without a restart', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'corpus-')), 'c.jsonl');
    writeFileSync(f, '{"type":"system","text":"a"}');
    corpusSettings.path = f;
    expect(activeCorpus()?.systems).toEqual(['a']);
    await Bun.sleep(10);
    writeFileSync(f, '{"type":"system","text":"b"}');
    expect(activeCorpus()?.systems).toEqual(['b']);
  });
});

describe('drawing canaries', () => {
  const shape = (s: Partial<BuyerShape> = {}): BuyerShape => ({
    maxTokens: 700,
    seed: false,
    system: false,
    promptChars: 100,
    ...s,
  });

  test('takes sampling and max_tokens from the buyer shape, unchanged', () => {
    const c = drawChatCanary(
      [prompt('hello')],
      [],
      shape({ temperature: 0.4, topP: 0.9, seed: true, maxTokens: 333 }),
      rng(1),
    );
    expect(c?.maxTokens).toBe(333);
    expect(c?.temperature).toBe(0.4);
    expect(c?.topP).toBe(0.9);
    expect(c?.seed).toBeGreaterThan(0);
    const plain = drawChatCanary([prompt('hello')], [], shape(), rng(1));
    expect(plain?.temperature).toBeUndefined();
    expect(plain?.topP).toBeUndefined();
    expect(plain?.seed).toBeUndefined();
  });

  test('prefers a prompt near the buyer length', () => {
    const prompts = [prompt('x'.repeat(20)), prompt('y'.repeat(2000))];
    const long = Array.from({ length: 50 }, (_, i) =>
      drawChatCanary(prompts, [], shape({ promptChars: 1900 }), rng(i)),
    );
    const longShare = long.filter((c) => c?.promptId === prompts[1]?.id).length / long.length;
    expect(longShare).toBeGreaterThan(0.9);
  });

  test('adds a system prompt from the corpus when the shape has one, and keeps an existing one', () => {
    const c = drawChatCanary([prompt('hi')], ['private sys'], shape({ system: true }), rng(1));
    expect(c?.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(c?.messages[0]?.content).toBe('private sys');
    const own = drawChatCanary([prompt('hi', 'own')], ['private sys'], shape({ system: true }), rng(1));
    expect(own?.messages[0]?.content).toBe('own');
    expect(own?.messages).toHaveLength(2);
    expect(drawChatCanary([prompt('hi')], [], shape({ system: true }), rng(1))?.messages).toHaveLength(1);
  });

  test('an empty corpus draws nothing', () => {
    expect(drawChatCanary([], [], shape(), rng(1))).toBeNull();
  });

  test('embedding batches are unique, and vary from a single input to a large batch', () => {
    const pool = Array.from({ length: 100 }, (_, i) => `text ${i}`);
    const sizes = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const batch = drawEmbeddingInputs(pool, rng(i));
      expect(new Set(batch).size).toBe(batch.length);
      sizes.add(batch.length);
    }
    expect(sizes.has(1)).toBe(true);
    expect(Math.max(...sizes)).toBeGreaterThan(16);
    expect(drawEmbeddingInputs(['only'], rng(1))).toEqual(['only']);
  });

  test('the prior before real traffic is seen is broad, not the old 16-64 tokens', () => {
    const shapes = Array.from({ length: 500 }, (_, i) => priorShape(rng(i)));
    expect(Math.max(...shapes.map((s) => s.maxTokens))).toBeGreaterThan(1500);
    expect(shapes.filter((s) => s.maxTokens === 1024).length).toBeGreaterThan(150);
    expect(shapes.some((s) => s.temperature === undefined)).toBe(true);
    expect(shapes.some((s) => s.temperature !== undefined && s.temperature > 0)).toBe(true);
  });
});
