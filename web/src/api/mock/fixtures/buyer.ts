import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const need = () => {
  const s = readMockSession();
  if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
  return s;
};
const hex = (c: string) => `0x${c.repeat(64)}`;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 864e5;

interface MockKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
const keys: MockKey[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'prod backend',
    prefix: 'sk-spdl-a1b2',
    createdAt: ago(12 * DAY),
    lastUsedAt: ago(3_600_000),
    revokedAt: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'old laptop',
    prefix: 'sk-spdl-9f3c',
    createdAt: ago(40 * DAY),
    lastUsedAt: ago(20 * DAY),
    revokedAt: ago(19 * DAY),
  },
];

// A deposit raises the mock balance only after a few polls, mimicking the 12-confirmation delay.
let balance = 18_420_000n;
let polls = 0;
let pendingDeposit: bigint | null = null;

const rand = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const ledger = [
  { id: 'bl_1', kind: 'deposit', micros: '50000000', jobId: null, txHash: hex('d'), createdAt: ago(9 * DAY) },
  {
    id: 'bl_2',
    kind: 'charge',
    micros: '-1240000',
    jobId: 'a0000000-0000-4000-8000-000000000001',
    txHash: null,
    createdAt: ago(2 * DAY),
  },
  {
    id: 'bl_3',
    kind: 'charge',
    micros: '-860000',
    jobId: 'a0000000-0000-4000-8000-000000000002',
    txHash: null,
    createdAt: ago(DAY),
  },
  {
    id: 'bl_4',
    kind: 'refund',
    micros: '120000',
    jobId: 'a0000000-0000-4000-8000-000000000002',
    txHash: null,
    createdAt: ago(DAY - 60_000),
  },
  { id: 'bl_5', kind: 'adjust', micros: '500000', jobId: null, txHash: null, createdAt: ago(5 * 3_600_000) },
];

export const buyerFixtures: MockFixtures = {
  'GET /v1/app/buyer': ({ mode }) => {
    const s = need();
    if (pendingDeposit !== null && ++polls >= 3) {
      balance += pendingDeposit;
      pendingDeposit = null;
    }
    const empty = mode === 'empty';
    return {
      address: s.address,
      balanceMicros: empty ? '0' : balance.toString(),
      reservedMicros: empty ? '0' : '350000',
      x402: { enabled: true, minSurchargeMicros: '1000', currentSurchargeMicros: '2400' },
    };
  },
  'POST /v1/app/buyer/_mock-deposit': ({ body }) => {
    pendingDeposit = BigInt((body as { amountMicros: string }).amountMicros);
    polls = 0;
    return {};
  },
  'GET /v1/app/buyer/ledger': ({ mode, query }) => {
    need();
    if (mode === 'empty') return { items: [], nextCursor: null };
    const page2 = query.get('cursor') === 'p2';
    if (page2) {
      return {
        items: [
          {
            id: 'bl_6',
            kind: 'charge',
            micros: '-310000',
            jobId: 'a0000000-0000-4000-8000-000000000003',
            txHash: null,
            createdAt: ago(11 * DAY),
          },
        ],
        nextCursor: null,
      };
    }
    return { items: ledger, nextCursor: 'p2' };
  },
  'GET /v1/app/buyer/usage': ({ mode, query }) => {
    need();
    const days = query.get('range') === '7d' ? 7 : query.get('range') === '90d' ? 90 : 30;
    if (mode === 'empty') return { byModel: [], series: [] };
    return {
      byModel: [
        {
          model: 'llama-3.1-8b-instruct',
          lane: 'open',
          jobs: ((412 * days) / 30) | 0,
          units: '3.2',
          spentMicros: String(((1_920_000 * days) / 30) | 0),
        },
        {
          model: 'qwen2.5-72b-instruct',
          lane: 'sealed',
          jobs: ((38 * days) / 30) | 0,
          units: '0.9',
          spentMicros: String(((2_480_000 * days) / 30) | 0),
        },
        {
          model: 'sdxl-turbo',
          lane: 'open',
          jobs: ((120 * days) / 30) | 0,
          units: '120',
          spentMicros: String(((1_200_000 * days) / 30) | 0),
        },
      ],
      series: Array.from({ length: Math.min(days, 30) }, (_, i) => ({
        ts: ago((Math.min(days, 30) - 1 - i) * DAY * (days / Math.min(days, 30))),
        spentMicros: String(80_000 + ((i * 7919) % 9) * 40_000),
        jobs: 5 + ((i * 13) % 17),
      })),
    };
  },
  'GET /v1/app/api-keys': ({ mode }) => {
    need();
    return mode === 'empty' ? [] : keys;
  },
  'POST /v1/app/api-keys': ({ body }) => {
    const s = need();
    if (s.freshUntil <= Date.now())
      throw new ApiError('REAUTH_REQUIRED', 'Please confirm with your wallet.', 401);
    const name = (body as { name: string }).name;
    const id = `${rand(8)}-${rand(4)}-4${rand(3)}-8${rand(3)}-${rand(12)}`;
    const key = `sk-spdl-${rand(40)}`;
    keys.unshift({
      id,
      name,
      prefix: key.slice(0, 12),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    });
    return { id, key };
  },
  'DELETE /v1/app/api-keys/:id': ({ params }) => {
    need();
    const k = keys.find((x) => x.id === params.id);
    if (!k) throw new ApiError('NOT_FOUND', 'API key not found.', 404);
    k.revokedAt = new Date().toISOString();
    return undefined;
  },
  'GET /v1/rate-card': () => [
    {
      gpuClass: 1,
      lane: 'open',
      unitKind: 'tokens_1m',
      providerMicrosPerUnit: '120000',
      buyerMicrosPerUnit: '150000',
    },
    {
      gpuClass: 2,
      lane: 'open',
      unitKind: 'image',
      providerMicrosPerUnit: '8000',
      buyerMicrosPerUnit: '10000',
    },
    {
      gpuClass: 3,
      lane: 'sealed',
      unitKind: 'tokens_1m',
      providerMicrosPerUnit: '2200000',
      buyerMicrosPerUnit: '2750000',
    },
    {
      gpuClass: 4,
      lane: 'sealed',
      unitKind: 'gpu_hour',
      providerMicrosPerUnit: '2400000',
      buyerMicrosPerUnit: '3000000',
    },
  ],
  'GET /v1/models': () => ({
    object: 'list',
    data: [
      {
        id: 'llama-3.1-8b-instruct',
        object: 'model',
        owned_by: 'spindle',
        lanes: ['open'],
        kind: 'chat',
        available: true,
        pricing: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '150000' },
      },
      {
        id: 'qwen2.5-72b-instruct',
        object: 'model',
        owned_by: 'spindle',
        lanes: ['open', 'sealed'],
        kind: 'chat',
        available: true,
        pricing: { unitKind: 'tokens_1m', buyerMicrosPerUnit: '2750000' },
      },
      {
        id: 'sdxl-turbo',
        object: 'model',
        owned_by: 'spindle',
        lanes: ['open'],
        kind: 'images',
        available: false,
        pricing: { unitKind: 'image', buyerMicrosPerUnit: '10000' },
      },
    ],
  }),
};
