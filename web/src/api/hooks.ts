import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { ApiError, type ApiMethod, apiFetch } from './client';
import { endpoints } from './endpoints';

export const qk = {
  session: ['session'] as const,
  me: ['me'] as const,
  networkStats: ['network-stats'] as const,
};

/** Hook factory: `const useNodes = createQuery(['nodes'], '/v1/app/nodes', schema)`. Later F-tasks use this. */
export function createQuery<S extends z.ZodType>(key: readonly unknown[], path: string, schema: S) {
  return (options: { enabled?: boolean; refetchInterval?: number } = {}) =>
    useQuery({ queryKey: key, queryFn: ({ signal }) => apiFetch(path, { schema, signal }), ...options });
}

export function createMutation<S extends z.ZodType, B = unknown>(method: ApiMethod, path: string, schema: S) {
  return () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body?: B) => apiFetch(path, { schema, method, body }),
      onSuccess: () => qc.invalidateQueries(),
    });
  };
}

/** Signed-in session or `null` when 401. Other errors surface as query errors. */
export function useSession() {
  return useQuery({
    queryKey: qk.session,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        return await endpoints.auth.session();
      } catch (e) {
        if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') return null;
        throw e;
      }
    },
  });
}

export function useMe(enabled = true) {
  return useQuery({ queryKey: qk.me, queryFn: endpoints.me, enabled, retry: false });
}

export function useNetworkStats() {
  return useQuery({ queryKey: qk.networkStats, queryFn: endpoints.networkStats, refetchInterval: 30_000 });
}

export async function setSession(
  qc: QueryClient,
  session: Awaited<ReturnType<typeof endpoints.auth.session>> | null,
) {
  qc.setQueryData(qk.session, session);
  if (!session) {
    qc.removeQueries({ queryKey: qk.me });
  } else {
    await qc.invalidateQueries({ queryKey: qk.me });
  }
}
