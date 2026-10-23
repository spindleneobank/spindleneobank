import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

let prefs: Record<string, unknown> = {};

export const meFixtures: MockFixtures = {
  'GET /v1/app/me': ({ mode }) => {
    const s = readMockSession();
    if (!s) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    return {
      address: s.address,
      prefs,
      isAdmin: new URLSearchParams(location.search).has('admin'),
      buyer: mode === 'empty' ? null : { id: 'buyer_mock_1', balanceMicros: '12500000' },
    };
  },
  'PATCH /v1/app/me': ({ body }) => {
    if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    prefs = { ...prefs, ...((body as { prefs?: Record<string, unknown> }).prefs ?? {}) };
    return { prefs };
  },
  'GET /v1/app/cards': ({ mode }) => {
    if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    if (mode === 'empty') return [];
    return [
      {
        id: 'card_mock_1',
        product: 'virtual',
        last4: '4242',
        status: 'issued',
        balanceUsdCents: '12500',
        finish: 'orchid',
        createdAt: new Date(Date.now() - 12 * 864e5).toISOString(),
      },
    ];
  },
};
