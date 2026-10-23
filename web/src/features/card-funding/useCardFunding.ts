import * as api from '@spindle/shared/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { z } from 'zod';
import { apiFetch } from '../../api/client';
import { ApiError } from '../../api/errors';
import { dk } from '../shell/queries';
import { fk, useCardOperation } from './api';
import { describeFunding } from './status';

export type RelayQuote = z.infer<typeof api.PostRelayQuoteRes>;

export type QuoteFailure = { kind: 'liquidity' | 'other'; message: string };

function quoteFailure(e: unknown): QuoteFailure {
  if (
    e instanceof ApiError &&
    (e.code === 'INSUFFICIENT_LIQUIDITY' || /INSUFFICIENT_LIQUIDITY/.test(e.message))
  ) {
    return {
      kind: 'liquidity',
      message: 'Temporarily unavailable — try a smaller amount or later. Nothing was charged.',
    };
  }
  return { kind: 'other', message: e instanceof Error ? e.message : 'Could not get a quote.' };
}

/**
 * Shared card funding state machine (issue + top-up use the same hook; F4 consumes it).
 * Server state is the source of truth: the op/relay status is polled, and a reload resumes from it. The
 * Relay quote is held in memory only: after a reload `quote()` is called again, and Relay omits the
 * approve step if the allowance is already in place, so a mined approve resumes at the deposit step.
 */
export function useCardFunding(operationId: string | null | undefined) {
  const qc = useQueryClient();
  const opQuery = useCardOperation(operationId);
  const [quoted, setQuoted] = useState<RelayQuote | null>(null);
  const [quoteError, setQuoteError] = useState<QuoteFailure | null>(null);

  const quoteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/v1/app/card-operations/${operationId}/relay-quote`, {
        schema: api.PostRelayQuoteRes,
        method: 'POST',
      }),
    onMutate: () => setQuoteError(null),
    onSuccess: (q) => {
      setQuoted(q);
      void qc.invalidateQueries({ queryKey: fk.op(operationId ?? '') });
    },
    onError: (e) => {
      setQuoted(null);
      setQuoteError(quoteFailure(e));
    },
  });

  const submitMutation = useMutation({
    mutationFn: (v: { step: 'approve' | 'deposit'; txHash: `0x${string}` }) =>
      apiFetch(`/v1/app/relay-orders/${quoted?.relayOrderId}/submitted`, {
        schema: api.PostRelayOrderSubmittedRes,
        method: 'POST',
        body: v,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fk.op(operationId ?? '') });
      void qc.invalidateQueries({ queryKey: dk.cards });
    },
  });

  const op = opQuery.data?.operation;
  const relay = opQuery.data?.relay ?? null;
  const view = useMemo(() => (op ? describeFunding(op, relay) : null), [op, relay]);
  const quote = useCallback(() => quoteMutation.mutate(), [quoteMutation]);
  const reportStep = submitMutation.mutate;

  return {
    query: opQuery,
    op,
    relay,
    view,
    quoted,
    clearQuote: () => setQuoted(null),
    quote,
    quoting: quoteMutation.isPending,
    quoteError,
    reportStep,
    reporting: submitMutation.isPending,
    reportError: submitMutation.error instanceof Error ? submitMutation.error.message : null,
  };
}
