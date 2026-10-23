import { beforeEach, describe, expect, it } from 'vitest';
import { clearHistory, loadHistory, saveHistory, titleFrom } from '../history';

const A = '0x00000000000000000000000000000000000000AA';
beforeEach(() => localStorage.clear());

describe('history', () => {
  it('round-trips per address (case-insensitive) and drops partial messages', () => {
    saveHistory(A, [
      {
        id: 'c1',
        title: 't',
        updatedAt: 1,
        messages: [
          { id: 'm1', role: 'user', content: 'hi' },
          { id: 'm2', role: 'assistant', content: 'par', partial: true },
        ],
      },
    ]);
    const got = loadHistory(A.toLowerCase());
    expect(got).toHaveLength(1);
    expect(got[0]?.messages.map((m) => m.id)).toEqual(['m1']);
    expect(loadHistory('0x0000000000000000000000000000000000000001')).toEqual([]);
  });
  it('clears and tolerates garbage', () => {
    localStorage.setItem(`spindle.chat.history.v1:${A.toLowerCase()}`, '{oops');
    expect(loadHistory(A)).toEqual([]);
    saveHistory(A, [{ id: 'c', title: 't', updatedAt: 1, messages: [] }]);
    clearHistory(A);
    expect(loadHistory(A)).toEqual([]);
  });
  it('titles', () => {
    expect(titleFrom('  hello   world ')).toBe('hello world');
    expect(titleFrom('x'.repeat(80))).toHaveLength(48);
  });
});
