import * as api from '@spindle/shared/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';
import { ApiError } from '../../api/errors';
import { setSession } from '../../api/hooks';

export const ck = {
  nodes: ['app', 'nodes'] as const,
  node: (id: string) => ['app', 'nodes', id] as const,
  params: ['app', 'staking', 'params'] as const,
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

/** Live node list, refreshed every 10 s while the page is visible (react-query pauses hidden tabs). */
export function useNodes() {
  const guard = useGuard();
  return useQuery({
    queryKey: ck.nodes,
    retry: false,
    refetchInterval: 10_000,
    queryFn: () => guard(() => apiFetch('/v1/app/nodes', { schema: api.GetNodesRes })),
  });
}

export function useNode(id: string | null, pollMs: number | false = false) {
  const guard = useGuard();
  return useQuery({
    queryKey: ck.node(id ?? ''),
    enabled: !!id,
    retry: false,
    refetchInterval: pollMs,
    queryFn: () => guard(() => apiFetch(`/v1/app/nodes/${id}`, { schema: api.GetNodeRes })),
  });
}

export function useStakingParams() {
  const guard = useGuard();
  return useQuery({
    queryKey: ck.params,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => guard(() => apiFetch('/v1/app/staking/params', { schema: api.GetStakingParamsRes })),
  });
}

export function useEnroll() {
  return useMutation({
    mutationFn: (body: { engine: 'ollama' | 'vllm'; os: 'linux' | 'windows' | 'macos'; name?: string }) =>
      apiFetch('/v1/app/nodes/enroll', { schema: api.PostNodesEnrollRes, method: 'POST', body }),
  });
}

export function usePair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch('/v1/app/nodes/pair', { schema: api.PostNodesPairRes, method: 'POST', body: { code } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.nodes }),
  });
}

export function useRename() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch(`/v1/app/nodes/${id}`, { schema: api.PatchNodeRes, method: 'PATCH', body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.nodes }),
  });
}

/** GETs that build a transaction. They are actions (register-call may ask the node to sign), not cached reads. */
export function useRegisterCall() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/v1/app/nodes/${id}/register-call`, { schema: api.GetNodeRegisterCallRes }),
  });
}

export function useStakeCall() {
  return useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: string }) =>
      apiFetch(`/v1/app/nodes/${id}/stake-call?amount=${amount}`, { schema: api.GetNodeStakeCallRes }),
  });
}
