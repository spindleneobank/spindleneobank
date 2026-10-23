import type { MockFixtures } from '../mock';

const MODELS = [
  {
    id: 'llama3.1:8b',
    object: 'model',
    owned_by: 'spindle',
    lanes: ['open'],
    kind: 'chat',
    available: true,
    pricing: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '400000' },
  },
  {
    id: 'qwen3:32b',
    object: 'model',
    owned_by: 'spindle',
    lanes: ['open', 'sealed'],
    kind: 'chat',
    available: true,
    pricing: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '1800000' },
  },
  {
    id: 'deepseek-r1:70b',
    object: 'model',
    owned_by: 'spindle',
    lanes: ['open'],
    kind: 'chat',
    available: false,
    pricing: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '3200000' },
  },
  {
    id: 'nomic-embed-text',
    object: 'model',
    owned_by: 'spindle',
    lanes: ['open'],
    kind: 'embeddings',
    available: true,
    pricing: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '20000' },
  },
];

export const modelFixtures: MockFixtures = {
  'GET /v1/models': ({ mode }) => ({ object: 'list', data: mode === 'empty' ? [] : MODELS }),
};
