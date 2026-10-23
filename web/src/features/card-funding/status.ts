import type { CardOpKind, CardOpStatus, RelayStatus } from '@spindle/shared/enums';

export type FundingPhase =
  | 'preparing'
  | 'pay'
  | 'bridging'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'review'
  | 'refund';

export type FundingView = {
  phase: FundingPhase;
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
  /** Terminal for polling purposes (success, failure, expiry). `review` keeps polling slowly. */
  terminal: boolean;
};

/** card-flows.md "Status model shown to the user". Success is shown ONLY for status `completed`. */
export function describeFunding(
  op: { kind: CardOpKind; status: CardOpStatus; error: string | null; id: string },
  relay: { status: RelayStatus; depositTx?: string | null } | null,
): FundingView {
  const rs = relay?.status;
  if (rs === 'refund' && op.status !== 'completed') {
    return { phase: 'refund', text: 'Bridge refunded USDG to your wallet', tone: 'warn', terminal: false };
  }
  switch (op.status) {
    case 'completed':
      return {
        phase: 'completed',
        text: op.kind === 'issue' ? 'Card ready' : 'Top-up complete',
        tone: 'ok',
        terminal: true,
      };
    case 'failed':
      return {
        phase: 'failed',
        text: `${op.error ?? 'The provider could not complete this operation.'} Support id: ${op.id}`,
        tone: 'danger',
        terminal: true,
      };
    case 'expired':
      return {
        phase: 'expired',
        text: 'Invoice expired — create a new one. Nothing was paid.',
        tone: 'neutral',
        terminal: true,
      };
    case 'review':
      return {
        phase: 'review',
        text: "We're checking this payment — no action needed",
        tone: 'info',
        terminal: false,
      };
    case 'created':
    case 'submitting':
      return { phase: 'preparing', text: 'Preparing invoice…', tone: 'info', terminal: false };
    case 'processing':
      return {
        phase: 'processing',
        text: op.kind === 'issue' ? 'Payment received, issuing card…' : 'Payment received, crediting card…',
        tone: 'info',
        terminal: false,
      };
    case 'awaiting_payment':
      // `signing` = approve reported but no deposit yet: the user still has to send the deposit.
      if (rs === 'signing' && !relay?.depositTx) {
        return {
          phase: 'pay',
          text: 'Approval sent — send the deposit to finish paying',
          tone: 'neutral',
          terminal: false,
        };
      }
      if (rs === 'signing' || rs === 'submitted' || rs === 'pending') {
        return { phase: 'bridging', text: 'Bridging…', tone: 'info', terminal: false };
      }
      if (rs === 'success') {
        return {
          phase: 'processing',
          text: op.kind === 'issue' ? 'Payment received, issuing card…' : 'Payment received, crediting card…',
          tone: 'info',
          terminal: false,
        };
      }
      return { phase: 'pay', text: 'Invoice ready — pay with USDG', tone: 'neutral', terminal: false };
  }
}
