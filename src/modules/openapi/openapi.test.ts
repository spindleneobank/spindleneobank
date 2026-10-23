import { expect, test } from 'bun:test';
import { buildOpenApiDocument } from './routes';

test('openapi document covers the public buyer API', () => {
  const doc = buildOpenApiDocument();
  expect(doc.openapi).toBe('3.1.0');
  for (const p of [
    '/v1/models',
    '/v1/chat/completions',
    '/v1/embeddings',
    '/v1/receipts/{jobId}',
    '/v1/epochs/{epoch}/tree',
    '/v1/x402/sessions',
  ])
    expect(doc.paths?.[p]).toBeDefined();
});
