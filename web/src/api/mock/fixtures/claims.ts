import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const need = () => {
  if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
};
const hex = (c: string) => `0x${c.repeat(64)}`;

export const claimFixtures: MockFixtures = {
  'GET /v1/app/claims': ({ mode }) => {
    need();
    if (mode === 'empty') return { items: [], nextCursor: null };
    return {
      items: [
        {
          id: 'clm_1',
          epoch: 1280,
          amountMicros: '60000000',
          txHash: hex('a'),
          blockNumber: 9_100_000,
          status: 'confirmed',
          createdAt: new Date(Date.now() - 6 * 864e5).toISOString(),
        },
        {
          id: 'clm_2',
          epoch: 1284,
          amountMicros: '60000000',
          txHash: hex('b'),
          blockNumber: 9_104_000,
          status: 'submitted',
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        },
      ],
      nextCursor: null,
    };
  },
  'GET /v1/epochs': ({ mode }) => {
    if (mode === 'empty') return { items: [], nextCursor: null };
    const mk = (epoch: number, ago: number, c: string, status: 'posted' | 'built') => ({
      epoch,
      root: hex(c),
      totalEarned: '9480000000',
      owners: 31,
      status,
      postedAt: status === 'posted' ? new Date(Date.now() - ago).toISOString() : null,
      txHash: status === 'posted' ? hex(c === 'c' ? 'd' : 'e') : null,
      claimableAt: new Date(Date.now() - ago + 3_600_000).toISOString(),
    });
    return {
      items: [
        mk(1287, 38 * 60_000, 'c', 'posted'),
        mk(1286, 98 * 60_000, '9', 'posted'),
        mk(1285, 158 * 60_000, '8', 'posted'),
      ],
      nextCursor: null,
    };
  },
};
