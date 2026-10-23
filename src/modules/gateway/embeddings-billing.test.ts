import { describe, expect, test } from 'bun:test';
import { billedUsage } from '../receipts/service';
import { embeddingsBilledTokens } from './service';

describe('embeddings billing cap', () => {
  test('an inflated node count is capped to the exact recount', () => {
    expect(embeddingsBilledTokens(125, { tokens: 100, estimated: false })).toBe(100);
  });
  test('an honest lower node count is billed as reported', () => {
    expect(embeddingsBilledTokens(85, { tokens: 100, estimated: false })).toBe(85);
  });
  test('an estimated recount leaves the node count', () => {
    expect(embeddingsBilledTokens(125, { tokens: 100, estimated: true })).toBe(125);
    expect(embeddingsBilledTokens(125, undefined)).toBe(125);
  });
  test('final (receipts) billing agrees with the provisional cap', () => {
    const view = {
      inputDigest: '',
      recountEstimated: false,
      recount: { promptTokens: 100, completionTokens: 0 },
    };
    const node = { p: 125, c: 0, n: 0 };
    const final = billedUsage('embeddings', node, view, true);
    expect(final?.units).toBe(embeddingsBilledTokens(125, { tokens: 100, estimated: false }));
  });
});
