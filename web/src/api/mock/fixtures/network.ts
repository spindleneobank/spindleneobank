import type { MockFixtures } from '../mock';

export const networkFixtures: MockFixtures = {
  'GET /v1/network/stats': ({ mode }) =>
    mode === 'empty'
      ? { nodesOnline: 0, nodesByLane: { open: 0, sealed: 0 }, jobs24h: 0, tokens24h: 0, latestEpoch: null }
      : {
          nodesOnline: 42,
          nodesByLane: { open: 38, sealed: 4 },
          jobs24h: 18240,
          tokens24h: 9_480_000,
          latestEpoch: 1287,
        },
};
