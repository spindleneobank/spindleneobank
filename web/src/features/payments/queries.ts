import * as api from '@spindle/shared/api';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { ApiError } from '../../api/errors';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const pk = {
  proof: (amount: string) => ['app', 'claim-proof', amount] as const,
  stocks: ['app', 'stocks'] as const,
  quote: (token: string, micros: string) => ['app', 'stocks-quote', token, micros] as const,
};

export function useClaimProof(enabled: boolean, amountKey: string) {
  return useQuery({
    queryKey: pk.proof(amountKey),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => apiFetch('/v1/app/claim/proof', { schema: api.GetClaimProofRes }),
  });
}

export function useStocks() {
  return useQuery({
    queryKey: pk.stocks,
    retry: false,
    staleTime: 60_000,
    queryFn: () => apiFetch('/v1/app/stocks', { schema: api.GetStocksRes }),
  });
}

export function useStockQuote(token: string | undefined, micros: bigint | null) {
  const key = micros === null ? '' : micros.toString();
  return useQuery({
    queryKey: pk.quote(token ?? '', key),
    enabled: !!token && micros !== null && micros > 0n,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () =>
      apiFetch('/v1/app/stocks/quote', {
        schema: api.PostStocksQuoteRes,
        method: 'POST',
        body: { token, amountInMicros: key },
      }),
  });
}

export const isCode = (e: unknown, code: string) => e instanceof ApiError && e.code === code;
