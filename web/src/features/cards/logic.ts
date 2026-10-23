import type * as api from '@spindle/shared/api';
import type { z } from 'zod';
import { ApiError } from '../../api/errors';

export type Operation = z.infer<typeof api.CardOperation>;
export type Relay = z.infer<typeof api.GetCardOperationRes>['relay'];
export type CardItem = z.infer<typeof api.CardView>;

/** UI ceiling per card (spec): $10,000. */
export const UI_MAX_CENTS = 1_000_000n;

/** "12.5" -> 1250n; null for anything that is not a plain dollar amount with up to 2 decimals. */
export function parseDollars(input: string): bigint | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return BigInt(m[1] as string) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

export function validateTopup(input: string, minCents: string, maxCents: string): string | null {
  const cents = parseDollars(input);
  if (cents === null) return 'Enter an amount in dollars, up to 2 decimals.';
  const min = BigInt(minCents);
  const max = BigInt(maxCents) < UI_MAX_CENTS ? BigInt(maxCents) : UI_MAX_CENTS;
  const fmt = (c: bigint) => `$${(c / 100n).toLocaleString('en-US')}`;
  if (cents < min) return `The minimum top-up is ${fmt(min)}.`;
  if (cents > max) return `The maximum top-up is ${fmt(max)}.`;
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Human wording for API failures on the card flows. Falls back to the server message. */
export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'LIVE_WRITES_DISABLED':
        return 'Card issuing and top-ups are switched off in this environment. Nothing was charged and nothing was sent to the provider.';
      case 'RATE_LIMITED':
        return 'You have reached the daily limit for card operations. Try again tomorrow.';
      case 'CONFLICT':
        return 'You already have an open invoice. Pay it or wait for it to expire before starting another.';
      case 'INSUFFICIENT_LIQUIDITY':
        return 'This route is temporarily unavailable. Try a smaller amount or try again later.';
      case 'UPSTREAM_UNAVAILABLE':
        return 'The card provider is not responding. Nothing was charged, try again shortly.';
      case 'REAUTH_REQUIRED':
        return 'Confirm with your wallet to continue.';
      case 'VALIDATION':
        return error.message || 'Please check the details and try again.';
      default:
        return error.message || 'Something went wrong. Try again.';
    }
  }
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}

export type Phase =
  | 'preparing'
  | 'pay'
  | 'bridging'
  | 'refunded'
  | 'confirming'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'review';

export type OpView = {
  phase: Phase;
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
  title: string;
  text: string;
  /** True while polling should continue quickly. */
  live: boolean;
  /** Only `pay` shows the Relay quote and signing steps. */
  canPay: boolean;
};

const PAYABLE_RELAY = new Set(['quoted', 'signing', 'expired', 'failed']);

/**
 * Maps backend operation + relay status to the copy from card-flows.md. Completed is shown ONLY when the
 * backend says `completed` (and, for an issue, the card itself is `issued`): never from a click or signature.
 */
export function describeOp(
  op: Operation,
  relay: Relay,
  cardStatus: CardItem['status'] | undefined,
  now = Date.now(),
): OpView {
  const issue = op.kind === 'issue';
  const invoiceExpired = op.invoice ? Date.parse(op.invoice.expiresAt) <= now : false;
  switch (op.status) {
    case 'created':
    case 'submitting':
      return {
        phase: 'preparing',
        tone: 'info',
        title: 'Preparing invoice…',
        text: 'We are asking the card provider for a payment invoice. This usually takes a few seconds.',
        live: true,
        canPay: false,
      };
    case 'awaiting_payment': {
      if (relay?.status === 'refund') {
        return {
          phase: 'refunded',
          tone: 'warn',
          title: 'Bridge refunded USDG to your wallet',
          text: 'The bridge could not fill this payment and returned your USDG. Nothing was lost. Wait for the invoice to expire, then start again.',
          live: true,
          canPay: false,
        };
      }
      if (relay && ['submitted', 'pending'].includes(relay.status)) {
        return {
          phase: 'bridging',
          tone: 'info',
          title: 'Bridging…',
          text: 'Your USDG is on its way to the card provider. Keep this page open or come back later.',
          live: true,
          canPay: false,
        };
      }
      if (relay?.status === 'success') {
        return {
          phase: 'confirming',
          tone: 'info',
          title: 'Bridge complete, waiting for the provider…',
          text: 'The provider has not confirmed the payment yet. This is not complete until it does.',
          live: true,
          canPay: false,
        };
      }
      if (invoiceExpired) {
        return {
          phase: 'expired',
          tone: 'warn',
          title: 'Invoice expired',
          text: 'Nothing was paid. Start a new one.',
          live: true,
          canPay: false,
        };
      }
      return {
        phase: 'pay',
        tone: 'warn',
        title: 'Pay with USDG',
        text: issue
          ? 'Pay the issue invoice with USDG. Relay converts it for you.'
          : 'Pay the top-up invoice with USDG. Relay converts it for you.',
        live: true,
        canPay: !relay || PAYABLE_RELAY.has(relay.status),
      };
    }
    case 'processing':
      return {
        phase: 'processing',
        tone: 'info',
        title: issue ? 'Payment received, issuing card…' : 'Payment received, crediting card…',
        text: issue
          ? 'The provider is issuing your card. This usually takes 1 to 3 minutes.'
          : 'Top-ups arrive about 1 to 3 minutes after the bridge.',
        live: true,
        canPay: false,
      };
    case 'completed':
      if (issue && cardStatus !== undefined && cardStatus !== 'issued') {
        return {
          phase: 'confirming',
          tone: 'info',
          title: 'Finalising your card…',
          text: 'Payment confirmed. Waiting for the card to show as issued.',
          live: true,
          canPay: false,
        };
      }
      return {
        phase: 'completed',
        tone: 'ok',
        title: issue ? 'Card ready' : 'Top-up complete',
        text: issue ? 'Your virtual card is issued.' : 'The funds are on your card.',
        live: false,
        canPay: false,
      };
    case 'failed':
      return {
        phase: 'failed',
        tone: 'danger',
        title: 'This did not go through',
        text: op.error ?? 'The provider rejected the request.',
        live: false,
        canPay: false,
      };
    case 'expired':
      return {
        phase: 'expired',
        tone: 'warn',
        title: 'Invoice expired',
        text: 'Nothing was paid. Create a new one.',
        live: false,
        canPay: false,
      };
    case 'review':
      return {
        phase: 'review',
        tone: 'warn',
        title: "We're checking this payment",
        text: 'No action needed. We are confirming this with the card provider and this page will update.',
        live: false,
        canPay: false,
      };
  }
}

/** Ordered tracker steps with done / current / todo marks, derived from the same inputs. */
export function trackerSteps(
  view: OpView,
  op: Operation,
): { label: string; state: 'done' | 'current' | 'todo' }[] {
  const order: Phase[] = ['preparing', 'pay', 'bridging', 'processing', 'completed'];
  const idx = (p: Phase) => {
    if (p === 'refunded') return 1;
    if (p === 'confirming') return op.status === 'completed' ? 3 : 3;
    if (p === 'failed' || p === 'expired' || p === 'review') return -1;
    return order.indexOf(p);
  };
  const labels = [
    'Invoice',
    'Pay with USDG',
    'Bridge',
    op.kind === 'issue' ? 'Issuing' : 'Crediting',
    'Done',
  ];
  const at = idx(view.phase);
  return labels.map((label, i) => ({
    label,
    state:
      at === -1
        ? 'todo'
        : i < at
          ? 'done'
          : i === at
            ? view.phase === 'completed'
              ? 'done'
              : 'current'
            : 'todo',
  }));
}

export function statusLabel(s: CardItem['status']): string {
  return {
    pending_payment: 'Awaiting payment',
    paid_pending_issue: 'Issuing',
    issued: 'Issued',
    failed: 'Failed',
  }[s];
}
export function statusTone(s: CardItem['status']): 'ok' | 'warn' | 'danger' {
  return s === 'issued' ? 'ok' : s === 'failed' ? 'danger' : 'warn';
}
