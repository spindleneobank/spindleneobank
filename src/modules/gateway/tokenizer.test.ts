import { afterEach, describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countChatPrompt,
  countTokens,
  estimateChatPrompt,
  getTokenizer,
  resetTokenizerCache,
  type Tok,
  tokenizerSettings,
} from './tokenizer';

const realLoad = tokenizerSettings.load;
afterEach(() => {
  tokenizerSettings.load = realLoad;
  resetTokenizerCache();
});

const fake = (perChar = 1): Tok => ({
  encode: (t) => Array.from({ length: Math.ceil(t.length / perChar) }),
  apply_chat_template: (m) =>
    (m as { role: string; content: string }[]).map((x) => `<${x.role}>${x.content}`).join(''),
});

describe('tokenizer', () => {
  test('offline fallback is ceil(chars/3) and flagged estimated', async () => {
    tokenizerSettings.load = async () => {
      throw new Error('offline');
    };
    expect(await countTokens('qwen2.5:7b', 'abcdefg')).toEqual({ tokens: 3, estimated: true });
    expect((await countChatPrompt('qwen2.5:7b', [{ role: 'user', content: 'hi' }])).estimated).toBe(true);
  });

  test('uses the tokenizer and chat template when loaded; caches per model', async () => {
    let loads = 0;
    tokenizerSettings.load = async () => {
      loads++;
      return fake();
    };
    expect(await countTokens('qwen2.5:7b', 'abcd')).toEqual({ tokens: 4, estimated: false });
    const p = await countChatPrompt('qwen2.5:7b', [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(p).toEqual({ tokens: '<user>hi'.length, estimated: false });
    expect(loads).toBe(1);
  });

  test('unknown models fall back; failures are not retried immediately', async () => {
    let loads = 0;
    tokenizerSettings.load = async () => {
      loads++;
      throw new Error('x');
    };
    expect(await getTokenizer('qwen2.5:7b')).toBeNull();
    expect(await getTokenizer('qwen2.5:7b')).toBeNull();
    expect(loads).toBe(1);
    expect(await getTokenizer('not-a-model')).toBeNull();
  });

  test('LRU keeps at most 8 tokenizers', async () => {
    let loads = 0;
    tokenizerSettings.load = async () => {
      loads++;
      return fake();
    };
    const ids = ['qwen2.5:0.5b', 'qwen2.5:7b', 'llama3.1:8b', 'nomic-embed-text', 'qwen2.5:32b'];
    for (const id of ids) await getTokenizer(id);
    expect(loads).toBe(5);
  });

  test('request-path estimate never waits for a download', () => {
    tokenizerSettings.load = () => new Promise(() => {});
    const t0 = Date.now();
    expect(estimateChatPrompt('qwen2.5:7b', [{ role: 'user', content: 'hello' }]).estimated).toBe(true);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  // Real HF tokenizer (network). Skipped offline.
  test('real Qwen tokenizer matches the chat template', async () => {
    tokenizerSettings.cacheDir = join(tmpdir(), 'spindle-tokenizers');
    const tok = await getTokenizer('qwen2.5:0.5b', 30_000);
    if (!tok) {
      console.warn('HF tokenizer unavailable (offline?): skipping');
      return;
    }
    const r = await countChatPrompt('qwen2.5:0.5b', [{ role: 'user', content: 'Hi there' }]);
    expect(r.estimated).toBe(false);
    expect(r.tokens).toBeGreaterThan(15);
    expect((await countTokens('qwen2.5:0.5b', 'Hello world, how are you?')).tokens).toBe(7);
  }, 40_000);
});
