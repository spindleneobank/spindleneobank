import * as api from '@spindle/shared/api';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockFetch } from '../../../api/mock/mock';

describe('buyer mock fixtures match the shared schemas', () => {
  beforeEach(() => {
    sessionStorage.setItem(
      'spindle-mock-session',
      JSON.stringify({ address: `0x${'1'.repeat(40)}`, freshUntil: Date.now() + 60_000 }),
    );
  });
  it('buyer, ledger, usage, keys, rate card, models', async () => {
    api.GetBuyerRes.parse(await mockFetch('GET', '/v1/app/buyer', undefined));
    api.GetBuyerLedgerRes.parse(await mockFetch('GET', '/v1/app/buyer/ledger?limit=10', undefined));
    api.GetBuyerUsageRes.parse(await mockFetch('GET', '/v1/app/buyer/usage?range=7d', undefined));
    api.GetApiKeysRes.parse(await mockFetch('GET', '/v1/app/api-keys', undefined));
    api.GetRateCardRes.parse(await mockFetch('GET', '/v1/rate-card', undefined));
    api.GetModelsRes.parse(await mockFetch('GET', '/v1/models', undefined));
  });
  it('create key requires a fresh session and returns the key once', async () => {
    const r = api.PostApiKeysRes.parse(await mockFetch('POST', '/v1/app/api-keys', { name: 'x' }));
    expect(r.key).toMatch(/^sk-spdl-/);
    sessionStorage.setItem(
      'spindle-mock-session',
      JSON.stringify({ address: `0x${'1'.repeat(40)}`, freshUntil: Date.now() - 1 }),
    );
    await expect(mockFetch('POST', '/v1/app/api-keys', { name: 'y' })).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
  });
});
