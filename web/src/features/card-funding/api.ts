import * as api from '@spindle/shared/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { erc20Abi } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { apiFetch } from '../../api/client';
import { env } from '../../config';
import { dk } from '../shell/queries';

export const fk = {
  op: (id: string) => ['app', 'card-op', id] as const,
  pricing: ['app', 'cards', 'pricing'] as const,
};

export function useUsdgBalance() {
  const { address } = useAccount();
  const q = useReadContract({
    address: env.addresses.usdg,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  return { connected: !!address, address, ...q };
}

export function useCardPricing() {
  return useQuery({
    queryKey: fk.pricing,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch('/v1/app/cards/pricing', { schema: api.GetCardsPricingRes }),
  });
}

export function useCreateTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { cardId: string; amountUsdCents: string }) =>
      apiFetch(`/v1/app/cards/${v.cardId}/topups`, {
        schema: api.PostCardTopupsRes,
        method: 'POST',
        body: { amountUsdCents: v.amountUsdCents },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dk.cards }),
  });
}

/** Op statuses that never change again; `review` keeps polling (admin may resolve it). */
const STOP = new Set(['completed', 'failed', 'expired']);

export function useCardOperation(id: string | null | undefined) {
  return useQuery({
    queryKey: fk.op(id ?? ''),
    enabled: !!id,
    retry: false,
    refetchInterval: (q) => {
      const s = q.state.data?.operation.status;
      if (s && STOP.has(s)) return false;
      return s === 'review' ? 10_000 : 2_500;
    },
    queryFn: () => apiFetch(`/v1/app/card-operations/${id}`, { schema: api.GetCardOperationRes }),
  });
}
