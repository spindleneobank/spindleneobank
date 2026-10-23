import * as api from '@spindle/shared/api';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { apiFetch } from '../../api/client';
import { dk } from '../shell/queries';

const ck = {
  pricing: ['app', 'cards', 'pricing'] as const,
  op: (id: string) => ['app', 'card-operation', id] as const,
  txs: (id: string) => ['app', 'card-transactions', id] as const,
};

export function useCardPricing() {
  return useQuery({
    queryKey: ck.pricing,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch('/v1/app/cards/pricing', { schema: api.GetCardsPricingRes }),
  });
}

/** Card list; polls while any card is not in a settled state. Shares its key with the Overview card panel. */
export function useCardList() {
  return useQuery({
    queryKey: dk.cards,
    retry: false,
    queryFn: () => apiFetch('/v1/app/cards', { schema: api.GetCardsRes }),
    refetchInterval: (q) => (q.state.data?.some((c) => c.pendingOperation) ? 5_000 : false),
  });
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { product: string; email: string; alias?: string; finish?: string }) =>
      apiFetch('/v1/app/cards', { schema: api.PostCardsRes, method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dk.cards }),
  });
}

export function useTopup(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountUsdCents: string) =>
      apiFetch(`/v1/app/cards/${cardId}/topups`, {
        schema: api.PostCardTopupsRes,
        method: 'POST',
        body: { amountUsdCents },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dk.cards }),
  });
}

type OpRes = z.infer<typeof api.GetCardOperationRes>;
const TERMINAL = new Set(['completed', 'failed', 'expired']);

/** Operation + Relay order. Polls fast until a terminal state; `review` keeps a slow poll (admin may resolve). */
export function useCardOperation(id: string | null) {
  const qc = useQueryClient();
  return useQuery<OpRes>({
    queryKey: ck.op(id ?? ''),
    enabled: !!id,
    retry: false,
    refetchInterval: (q) => {
      const s = q.state.data?.operation.status;
      if (s && TERMINAL.has(s)) return false;
      return s === 'review' ? 20_000 : 3_000;
    },
    queryFn: async ({ signal }): Promise<OpRes> => {
      const res = await apiFetch(`/v1/app/card-operations/${id}`, {
        schema: api.GetCardOperationRes,
        signal,
      });
      if (TERMINAL.has(res.operation.status)) void qc.invalidateQueries({ queryKey: dk.cards });
      return res;
    },
  });
}

export function useRelayQuote(opId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(`/v1/app/card-operations/${opId}/relay-quote`, {
        schema: api.PostRelayQuoteRes,
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.op(opId) }),
  });
}

export function useRelaySubmitted(opId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { relayOrderId: string; step: 'approve' | 'deposit'; txHash: string }) =>
      apiFetch(`/v1/app/relay-orders/${v.relayOrderId}/submitted`, {
        schema: api.PostRelayOrderSubmittedRes,
        method: 'POST',
        body: { step: v.step, txHash: v.txHash },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.op(opId) }),
  });
}

export function useCardTransactions(cardId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ck.txs(cardId),
    enabled,
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      apiFetch(`/v1/app/cards/${cardId}/transactions?limit=5${pageParam ? `&cursor=${pageParam}` : ''}`, {
        schema: api.GetCardTransactionsRes,
      }),
  });
}

/** Not a react-query call on purpose: card details must never enter the query cache. */
export const revealCard = (cardId: string) =>
  apiFetch(`/v1/app/cards/${cardId}/reveal`, { schema: api.PostCardRevealRes, method: 'POST' });

export const pollApplePay = (cardId: string) =>
  apiFetch(`/v1/app/cards/${cardId}/apple-pay`, { schema: api.GetCardApplePayRes });
