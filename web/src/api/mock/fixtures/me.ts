import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

export const meFixtures: MockFixtures = {
  'GET /v1/app/me': ({ mode }) => {
    const s = readMockSession();
    if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    return {
      address: s.address,
      prefs: {},
      isAdmin: new URLSearchParams(location.search).has('admin'),
      buyer: mode === 'empty' ? null : { id: 'buyer_mock_1', balanceMicros: '12500000' },
    };
  },
};
