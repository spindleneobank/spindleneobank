import { env } from '../../../config';
import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const scenario = () => new URLSearchParams(window.location.search).get('scenario');

/** `?scenario=nothing` -> 409 CHAIN_STATE (no root yet); `?scenario=below` -> 409 with details.belowMinimum. */
export const claimProofFixtures: MockFixtures = {
  'GET /v1/app/claim/proof': ({ mode }) => {
    if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    const s = scenario();
    if (mode === 'empty' || s === 'nothing') {
      throw new ApiError('CHAIN_STATE', 'Nothing is claimable yet', 409, { belowMinimum: false });
    }
    if (s === 'below') {
      throw new ApiError('CHAIN_STATE', 'Claimable amount is below the minimum', 409, { belowMinimum: true });
    }
    return {
      epoch: 1287,
      cumulativeMicros: '172400000',
      proof: [`0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`],
      claimedMicros: '120000000',
      claimableMicros: '52400000',
      contract: env.addresses.claims,
      abiFn: 'claim',
    };
  },
};
