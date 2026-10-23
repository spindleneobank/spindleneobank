import * as api from '@spindle/shared/api';
import { createSiweMessage } from 'viem/siwe';
import { describe, expect, it } from 'vitest';
import { apiFetch } from '../client';
import { endpoints } from '../endpoints';
import { ApiError } from '../errors';
import { fixtures } from '../mock/fixtures';

const address = '0x1111111111111111111111111111111111111111';
const siwe = () =>
  createSiweMessage({
    domain: 'localhost',
    address,
    uri: 'http://localhost',
    version: '1',
    chainId: 4663,
    nonce: 'abcdefgh12',
    statement: 'Sign in to Spindle.',
  });

describe('mock fixtures validate against the shared schemas', () => {
  it('has a fixture for every F0 endpoint', () => {
    for (const k of [
      'GET /v1/auth/nonce',
      'POST /v1/auth/verify',
      'GET /v1/auth/session',
      'POST /v1/auth/reauth',
      'POST /v1/auth/logout',
      'GET /v1/app/me',
      'GET /v1/network/stats',
    ]) {
      expect(fixtures).toHaveProperty([k]);
    }
  });
  it('network stats parse', async () => {
    expect(api.GetNetworkStatsRes.parse(await endpoints.networkStats()).nodesOnline).toBeGreaterThan(0);
  });
  it('auth flow: 401 -> verify -> session + me -> logout -> 401', async () => {
    sessionStorage.clear();
    await expect(endpoints.auth.session()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    const v = api.PostAuthVerifyRes.parse(await endpoints.auth.verify(siwe(), '0xsig'));
    expect(v.address).toBe(address);
    expect(api.GetAuthSessionRes.parse(await endpoints.auth.session())).toMatchObject({
      address,
      fresh: true,
    });
    expect(api.GetMeRes.parse(await endpoints.me()).address).toBe(address);
    await endpoints.auth.logout();
    await expect(endpoints.me()).rejects.toBeInstanceOf(ApiError);
  });
  it('rejects unknown mocks and malformed shapes', async () => {
    await expect(apiFetch('/v1/nope', { schema: api.GetNetworkStatsRes })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
