import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const need = () => {
  if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
};
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const ledgerRows = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const kind = i % 7 === 6 ? 'slash' : i % 4 === 3 ? 'floor' : 'job';
    const micros = kind === 'slash' ? '-250000' : kind === 'floor' ? '1800000' : String(420_000 + i * 13_337);
    return {
      id: `led_${String(i).padStart(3, '0')}`,
      ts: iso(Date.now() - i * 5 * H),
      nodeId: i % 2 ? 'node_mock_b' : 'node_mock_a',
      jobId: kind === 'job' ? `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` : null,
      kind,
      micros,
      epoch: i < 3 ? null : 1287 - Math.floor(i / 8),
    };
  });

export const earningsFixtures: MockFixtures = {
  'GET /v1/app/earnings/summary': ({ mode }) => {
    need();
    if (mode === 'empty') {
      return {
        totalEarnedMicros: '0',
        claimedMicros: '0',
        claimableMicros: '0',
        pendingMicros: '0',
        latestEpoch: null,
        nextEpochAt: null,
        claimableAt: null,
        minClaimMicros: '1000000',
        nodes: { total: 0, online: 0 },
      };
    }
    return {
      totalEarnedMicros: '184250000',
      claimedMicros: '120000000',
      claimableMicros: '52400000',
      pendingMicros: '11850000',
      latestEpoch: 1287,
      nextEpochAt: iso(Date.now() + 37 * 60_000),
      claimableAt: iso(Date.now() + 22 * 60_000),
      minClaimMicros: '1000000',
      nodes: { total: 3, online: 2 },
    };
  },
  'GET /v1/app/earnings/series': ({ mode, query }) => {
    need();
    const days = { '7d': 7, '30d': 30, '90d': 90 }[query.get('range') ?? '7d'] ?? 7;
    if (mode === 'empty') return { buckets: [] };
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = days - 1 - i;
      return {
        ts: iso(Date.now() - d * 24 * H),
        jobMicros: String(2_000_000 + ((i * 7919) % 5) * 1_100_000),
        floorMicros: String(i % 3 === 0 ? 1_500_000 : 0),
        slashMicros: String(i % 11 === 5 ? 900_000 : 0),
      };
    });
    return { buckets };
  },
  'GET /v1/app/earnings/ledger': ({ mode, query }) => {
    need();
    if (mode === 'empty') return { items: [], nextCursor: null };
    const all = ledgerRows(34);
    const start = Number(query.get('cursor') ?? 0);
    const limit = Number(query.get('limit') ?? 25);
    const items = all.slice(start, start + limit);
    return { items, nextCursor: start + limit < all.length ? String(start + limit) : null };
  },
  'GET /v1/app/earnings/statement.csv': () => {
    need();
    return 'ts,kind,micros,epoch\n2026-10-22T10:00:00Z,job,420000,1287\n';
  },
};
