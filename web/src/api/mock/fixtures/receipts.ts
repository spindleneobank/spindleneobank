import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const need = () => {
  if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
};
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const MODELS = ['llama-3.3-70b', 'qwen3-32b', 'deepseek-r1-14b', 'gemma-3-27b'];

const reported = new Set<string>();

const rows = Array.from({ length: 40 }, (_, i) => {
  const failed = i % 9 === 4;
  const pending = i < 2;
  return {
    jobId: id(i),
    model: MODELS[i % 4] as string,
    kind: 'chat' as const,
    lane: i % 5 === 0 ? ('sealed' as const) : ('open' as const),
    nodeName: i % 2 ? 'rig-berlin-2' : 'home-4090',
    gpu: i % 2 ? 'NVIDIA H100' : 'NVIDIA RTX 4090',
    units: String(12 + i * 3),
    unitKind: 'tokens_1m' as const,
    providerMicros: failed ? '0' : String(310_000 + i * 9_001),
    status: failed ? ('failed' as const) : pending ? ('running' as const) : ('completed' as const),
    verified: failed ? false : pending ? null : true,
    createdAt: new Date(Date.now() - i * 47 * 60_000).toISOString(),
  };
});

export const receiptFixtures: MockFixtures = {
  'GET /v1/app/receipts': ({ mode, query }) => {
    need();
    if (mode === 'empty') return { items: [], nextCursor: null };
    const lane = query.get('lane');
    const q = (query.get('q') ?? '').toLowerCase();
    const all = rows.filter(
      (r) =>
        (!lane || r.lane === lane) && (!q || `${r.model} ${r.nodeName} ${r.jobId}`.toLowerCase().includes(q)),
    );
    const start = Number(query.get('cursor') ?? 0);
    const limit = Number(query.get('limit') ?? 25);
    return {
      items: all.slice(start, start + limit),
      nextCursor: start + limit < all.length ? String(start + limit) : null,
    };
  },
  'POST /v1/app/receipts/:jobId/report': ({ params }) => {
    need();
    reported.add(params.jobId as string);
    return { id: 'report_mock', status: 'open' };
  },
  'GET /v1/app/receipts/:jobId': ({ params }) => {
    need();
    const r = rows.find((x) => x.jobId === params.jobId);
    if (!r) throw new ApiError('NOT_FOUND', 'Receipt not found', 404);
    const failed = r.verified === false;
    return {
      jobId: r.jobId,
      nodeId: 'node_mock_a',
      onchainNodeId: '7',
      nodeKey: '0x1111111111111111111111111111111111111111',
      lane: r.lane,
      model: r.model,
      usage: { p: 812, c: 304 },
      cose: 'UEsDBBQAAAAIAHNwbGluZGxlLW1vY2stY29zZS1zaWduMS1ieXRlcw==',
      payload: { job: r.jobId },
      verified: r.verified === true,
      reason: failed ? 'signature_mismatch' : null,
      attestationRef: r.lane === 'sealed' ? 'att_0xab12cd34' : null,
      epoch: failed ? null : 1287,
      earning: failed ? null : { providerMicros: r.providerMicros, epoch: 1287 },
      canReport: !reported.has(r.jobId),
    };
  },
};
