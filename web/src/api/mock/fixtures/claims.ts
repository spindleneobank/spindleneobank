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
  'GET /v1/epochs/latest': ({ mode }) => {
    if (mode === 'empty') throw new ApiError('NOT_FOUND', 'No epoch yet', 404);
    return {
      epoch: 1287,
      root: hex('c'),
      totalEarned: '9480000000',
      postedAt: new Date(Date.now() - 38 * 60_000).toISOString(),
      txHash: hex('d'),
      claimableAt: new Date(Date.now() + 22 * 60_000).toISOString(),
    };
  },
};
