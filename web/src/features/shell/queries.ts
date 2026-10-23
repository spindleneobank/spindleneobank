import * as api from '@spindle/shared/api';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { apiFetch } from '../../api/client';
import { ApiError } from '../../api/errors';
import { qk, setSession } from '../../api/hooks';
import { mockFetch } from '../../api/mock/mock';
import { env } from '../../config';

/** Any 401 from a data call drops the session so the gate falls back to the signed-out state. */
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

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const dk = {
  summary: ['app', 'summary'] as const,
  recent: ['app', 'receipts', 'recent'] as const,
  cards: ['app', 'cards'] as const,
  series: (range: string) => ['app', 'series', range] as const,
  ledger: ['app', 'ledger'] as const,
  claims: ['app', 'claims'] as const,
  epoch: ['epoch', 'latest'] as const,
  receipts: (lane: string, q: string) => ['app', 'receipts', 'list', lane, q] as const,
  receipt: (id: string) => ['app', 'receipt', id] as const,
};

export function useSummary() {
  const guard = useGuard();
  return useQuery({
    queryKey: dk.summary,
    retry: false,
    queryFn: () => guard(() => apiFetch('/v1/app/earnings/summary', { schema: api.GetEarningsSummaryRes })),
  });
}

export function useRecentReceipts(limit = 5) {
  const guard = useGuard();
  return useQuery({
    queryKey: [...dk.recent, limit],
    retry: false,
    queryFn: () =>
      guard(() => apiFetch(`/v1/app/receipts${qs({ limit })}`, { schema: api.GetAppReceiptsRes })),
  });
}

export function useCards() {
  const guard = useGuard();
  return useQuery({
    queryKey: dk.cards,
    retry: false,
    queryFn: () => guard(() => apiFetch('/v1/app/cards', { schema: api.GetCardsRes })),
  });
}

export function useSeries(range: '7d' | '30d' | '90d') {
  const guard = useGuard();
  return useQuery({
    queryKey: dk.series(range),
    retry: false,
    queryFn: () =>
      guard(() => apiFetch(`/v1/app/earnings/series${qs({ range })}`, { schema: api.GetEarningsSeriesRes })),
  });
}

export function useLedger() {
  const guard = useGuard();
  return useInfiniteQuery({
    queryKey: dk.ledger,
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: z.infer<typeof api.GetEarningsLedgerRes>) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      guard(() =>
        apiFetch(`/v1/app/earnings/ledger${qs({ limit: 10, cursor: pageParam })}`, {
          schema: api.GetEarningsLedgerRes,
        }),
      ),
  });
}

export function useClaims() {
  const guard = useGuard();
  return useQuery({
    queryKey: dk.claims,
    retry: false,
    queryFn: () => guard(() => apiFetch('/v1/app/claims?limit=10', { schema: api.GetClaimsRes })),
  });
}

export function useLatestEpoch() {
  return useQuery({
    queryKey: dk.epoch,
    retry: false,
    queryFn: async () => {
      try {
        return await apiFetch('/v1/epochs/latest', { schema: api.GetEpochsLatestRes });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null; // no epoch posted yet
        throw e;
      }
    },
  });
}

export function useReceipts(lane: string, q: string) {
  const guard = useGuard();
  return useInfiniteQuery({
    queryKey: dk.receipts(lane, q),
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: z.infer<typeof api.GetAppReceiptsRes>) => last.nextCursor ?? undefined,
    queryFn: ({ pageParam }) =>
      guard(() =>
        apiFetch(`/v1/app/receipts${qs({ limit: 15, lane, q, cursor: pageParam })}`, {
          schema: api.GetAppReceiptsRes,
        }),
      ),
  });
}

export function useReceipt(jobId: string | null) {
  const guard = useGuard();
  return useQuery({
    queryKey: dk.receipt(jobId ?? ''),
    enabled: !!jobId,
    retry: false,
    queryFn: () => guard(() => apiFetch(`/v1/app/receipts/${jobId}`, { schema: api.GetAppReceiptRes })),
  });
}

type Prefs = z.infer<typeof api.Prefs>;

/** Optimistic prefs save with rollback on error. */
export function useSavePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Prefs) =>
      apiFetch('/v1/app/me', { schema: api.PatchMeRes, method: 'PATCH', body: { prefs } }),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: qk.me });
      const prev = qc.getQueryData<z.infer<typeof api.GetMeRes>>(qk.me);
      if (prev) qc.setQueryData(qk.me, { ...prev, prefs: { ...prev.prefs, ...prefs } });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.me, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

/** Statement CSV download (text/csv, not JSON). */
export async function downloadStatement(): Promise<void> {
  const path = '/v1/app/earnings/statement.csv';
  let text: string;
  if (env.mock) {
    text = (await mockFetch('GET', path, undefined)) as string;
  } else {
    const res = await fetch(`${env.apiUrl}${path}`, { credentials: 'include' });
    if (!res.ok) throw new ApiError('INTERNAL', 'Statement export failed', res.status);
    text = await res.text();
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spindle-statement.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
