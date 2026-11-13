import { expect, test } from 'bun:test';
import { balanceRefreshPending } from './service';

test('a refresh is pending only for a provider card with a cleared sync time that has not failed', () => {
  const base = { syncedAt: null, providerCardId: 'card_1', status: 'issued' };
  expect(balanceRefreshPending(base)).toBe(true);
  expect(balanceRefreshPending({ ...base, syncedAt: new Date() })).toBe(false);
  // never picked by the sync loop, so it must not keep clients polling forever
  expect(balanceRefreshPending({ ...base, providerCardId: null })).toBe(false);
  expect(balanceRefreshPending({ ...base, status: 'failed' })).toBe(false);
});
