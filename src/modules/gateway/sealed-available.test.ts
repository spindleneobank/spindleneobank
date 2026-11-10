import { expect, test } from 'bun:test';
import { sealedAvailableFor } from './service';

const both = { lanes: ['open', 'sealed'] as ('open' | 'sealed')[] };
const openOnly = { lanes: ['open'] as ('open' | 'sealed')[] };

test('needs the lane switched on, a sealed model and a registered sealed node', () => {
  expect(sealedAvailableFor(both, [{ registered: true }], true)).toBe(true);
  expect(sealedAvailableFor(both, [{ registered: true }], false)).toBe(false);
  expect(sealedAvailableFor(openOnly, [{ registered: true }], true)).toBe(false);
  expect(sealedAvailableFor(both, [], true)).toBe(false);
});

test('an unregistered sealed node does not count', () => {
  expect(sealedAvailableFor(both, [{ registered: false }], true)).toBe(false);
  expect(sealedAvailableFor(both, [{ registered: false }, { registered: true }], true)).toBe(true);
});
