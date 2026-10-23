import * as api from '@spindle/shared/api';
import { apiFetch } from './client';

const empty = api.PostAuthLogoutRes;

export const endpoints = {
  auth: {
    nonce: () => apiFetch('/v1/auth/nonce', { schema: api.GetAuthNonceRes }),
    verify: (message: string, signature: string) =>
      apiFetch('/v1/auth/verify', {
        schema: api.PostAuthVerifyRes,
        method: 'POST',
        body: { message, signature },
      }),
    session: () => apiFetch('/v1/auth/session', { schema: api.GetAuthSessionRes }),
    reauth: (message: string, signature: string) =>
      apiFetch('/v1/auth/reauth', {
        schema: api.PostAuthReauthRes,
        method: 'POST',
        body: { message, signature },
      }),
    logout: () => apiFetch('/v1/auth/logout', { schema: empty, method: 'POST' }),
  },
  me: () => apiFetch('/v1/app/me', { schema: api.GetMeRes }),
  networkStats: () => apiFetch('/v1/network/stats', { schema: api.GetNetworkStatsRes }),
};
