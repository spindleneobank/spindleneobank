import {
  meResponseSchema,
  networkStatsSchema,
  nonceResponseSchema,
  reauthResponseSchema,
  sessionResponseSchema,
  verifyResponseSchema,
} from '@spindle/shared';
import { z } from 'zod';
import { apiFetch } from './client';

const empty = z.undefined();

export const endpoints = {
  auth: {
    nonce: () => apiFetch('/v1/auth/nonce', { schema: nonceResponseSchema }),
    verify: (message: string, signature: string) =>
      apiFetch('/v1/auth/verify', {
        schema: verifyResponseSchema,
        method: 'POST',
        body: { message, signature },
      }),
    session: () => apiFetch('/v1/auth/session', { schema: sessionResponseSchema }),
    reauth: (message: string, signature: string) =>
      apiFetch('/v1/auth/reauth', {
        schema: reauthResponseSchema,
        method: 'POST',
        body: { message, signature },
      }),
    logout: () => apiFetch('/v1/auth/logout', { schema: empty, method: 'POST' }),
  },
  me: () => apiFetch('/v1/app/me', { schema: meResponseSchema }),
  networkStats: () => apiFetch('/v1/network/stats', { schema: networkStatsSchema }),
};
