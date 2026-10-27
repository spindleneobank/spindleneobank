import { describe, expect, it } from 'vitest';
import { completionBudget, estimateTokens, fitHistory } from '../fit';

const msg = (role: 'user' | 'assistant' | 'system', chars: number) => ({ role, content: 'x'.repeat(chars) });

describe('fitHistory', () => {
  it('keeps everything when it fits or the window is unknown', () => {
    const h = [msg('user', 300), msg('assistant', 300), msg('user', 30)];
    expect(fitHistory(h, 4096)).toEqual({ messages: h, omitted: 0, maxTokens: 1024 });
    expect(fitHistory(h, undefined).omitted).toBe(0);
  });

  it('drops the oldest turns until prompt + max_tokens fits, keeping system and the latest message', () => {
    const sys = msg('system', 30);
    const h = [
      sys,
      ...Array.from({ length: 10 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', 3000)),
      msg('user', 600),
    ];
    const r = fitHistory(h, 4096);
    expect(r.messages[0]).toEqual(sys);
    expect(r.messages.at(-1)).toEqual(h.at(-1));
    expect(r.omitted).toBeGreaterThan(0);
    const prompt = r.messages.reduce((n, m) => n + estimateTokens(m.content) + 8, 0);
    expect(prompt + r.maxTokens).toBeLessThanOrEqual(4096 * 0.9);
    // what is kept is a contiguous suffix of the conversation
    expect(h.slice(h.length - (r.messages.length - 1))).toEqual(r.messages.slice(1));
  });

  it('always keeps the latest message, even when it alone is too long', () => {
    const r = fitHistory([msg('user', 100), msg('user', 60000)], 4096);
    expect(r.messages).toHaveLength(1);
    expect(r.omitted).toBe(1);
  });

  it('shrinks max_tokens on small windows', () => {
    expect(completionBudget(2048)).toBe(512);
    expect(completionBudget(32768)).toBe(1024);
  });
});
