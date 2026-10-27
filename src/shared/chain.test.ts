import { expect, test } from 'bun:test';
import { chainFor, chainName, rhc } from './chain';
import { networkFor } from './x402';

test('rhc is the real chain; the dev fork gets its own id and a readable name', () => {
  expect(rhc.id).toBe(4663);
  expect(chainName(4663)).toBe('Robinhood Chain');
  expect(chainFor(31337).id).toBe(31337);
  expect(chainFor(31337).name).toBe('Robinhood Chain (local fork)');
  expect(networkFor(31337)).toBe('eip155:31337');
});
