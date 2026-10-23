import * as api from '@spindle/shared/api';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { apiFetch } from '../../api/client';
import { ApiError } from '../../api/errors';
import { setSession } from '../../api/hooks';

export type Range = '7d' | '30d' | '90d';

export const bk = {
  buyer: ['app', 'buyer'] as const,
  ledger: ['app', 'buyer', 'ledger'] as const,
  usage: (r: Range) => ['app', 'buyer', 'usage', r] as const,
  keys: ['app', 'api-keys'] as const,
  rateCard: ['rate-card'] as const,
  models: ['models'] as const,
};

/** A 401 from a data call drops the session so the gate falls back to signed-out. */
function useGuard() {
  const qc = useQueryClient();
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') await setSession(qc, null);
      throw e;
    }
  };
}

export function useBuyer(refetchInterval?: number | false) {
  const guard = useGuard();
  return useQuery({
    queryKey: bk.buyer,
    retry: false,
    refetchInterval,
    queryFn: () => guard(() => apiFetch('/v1/app/buyer', { schema: api.GetBuyerRes })),
  });
}

export function useBuyerLedger() {
  const guard = useGuard();
  return useInfiniteQuery({
    queryKey: bk.ledger,
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: z.infer<typeof api.GetBuyerLedgerRes>) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      guard(() =>
        apiFetch(
          `/v1/app/buyer/ledger?limit=10${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
          {
            schema: api.GetBuyerLedgerRes,
          },
        ),
      ),
  });
}

export function useBuyerUsage(range: Range) {
  const guard = useGuard();
  return useQuery({
    queryKey: bk.usage(range),
    retry: false,
    queryFn: () =>
      guard(() => apiFetch(`/v1/app/buyer/usage?range=${range}`, { schema: api.GetBuyerUsageRes })),
  });
}

export function useApiKeys() {
  const guard = useGuard();
  return useQuery({
    queryKey: bk.keys,
    retry: false,
    queryFn: () => guard(() => apiFetch('/v1/app/api-keys', { schema: api.GetApiKeysRes })),
  });
}

/** `run` wraps the call (withReauth) so the SIWE re-sign happens once on REAUTH_REQUIRED. */
export function useCreateKey(run: <T>(fn: () => Promise<T>) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      run(() => apiFetch('/v1/app/api-keys', { schema: api.PostApiKeysRes, method: 'POST', body: { name } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: bk.keys }),
  });
}

export function useRevokeKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/app/api-keys/${id}`, { schema: api.DeleteApiKeyRes, method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: bk.keys }),
  });
}

export function useRateCard() {
  return useQuery({
    queryKey: bk.rateCard,
    retry: false,
    queryFn: () => apiFetch('/v1/rate-card', { schema: api.GetRateCardRes }),
  });
}

export function useModels() {
  return useQuery({
    queryKey: bk.models,
    retry: false,
    queryFn: () => apiFetch('/v1/models', { schema: api.GetModelsRes }),
  });
}
