import { describe, expect, it } from 'vitest';
import { JournalError, SessionJournal } from '../journal';

const acct = '0x00000000000000000000000000000000000000aa' as const;
const rec = {
  id: 's1',
  account: acct,
  chainId: 4663,
  token: '0x01',
  spender: '0x05',
  capMicros: '1000000',
};
function mem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('SessionJournal', () => {
  it('refuses when storage is unavailable', () => {
    const j = new SessionJournal(acct, 4663, null);
    expect(() => j.begin(rec)).toThrow(JournalError);
  });
  it('allows one unresolved record per account and chain', () => {
    const j = new SessionJournal(acct, 4663, mem());
    j.begin(rec, 1000);
    expect(() => j.begin({ ...rec, id: 's2' }, 2000)).toThrow(/unresolved/);
  });
  it('drops an unresolved record after the pending window', () => {
    const j = new SessionJournal(acct, 4663, mem());
    j.begin(rec, 0);
    expect(j.current(11 * 60_000)).toBeNull();
    expect(() => j.begin({ ...rec, id: 's2' }, 11 * 60_000)).not.toThrow();
  });
  it('allows a new record once the previous is open, and clear removes it', () => {
    const j = new SessionJournal(acct, 4663, mem());
    j.begin(rec);
    j.advance('open');
    expect(j.current()?.status).toBe('open');
    expect(() => j.begin({ ...rec, id: 's2' })).not.toThrow();
    j.clear();
    expect(j.current()).toBeNull();
  });
});
