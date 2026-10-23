import { useCallback, useEffect, useState } from 'react';
import type { Hash } from 'viem';
import { CTA } from '../../components/CTA';
import { ErrorState } from '../../components/ErrorState';
import { formatCents, formatMicros } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { explorerTx } from '../../config';
import { countdown, useNow } from '../shell/ui';
import { useCardPricing } from './api';
import { type RawTx, TxStepButton } from './TxStepButton';
import { type RelayQuote, useCardFunding } from './useCardFunding';
import './funding.css';

const STEP_LABEL: Record<string, string> = { approve: 'Approve USDG', deposit: 'Send deposit' };
const STEP_HINT: Record<string, string> = {
  approve: 'Lets the Relay depository pull the exact USDG amount. You pay the gas.',
  deposit: 'Sends USDG to Relay, which pays the izipay invoice for you. You pay the gas.',
};

function StepRunner({
  quote,
  onReport,
}: {
  quote: RelayQuote;
  onReport: (step: 'approve' | 'deposit', hash: Hash) => void;
}) {
  const actions = quote.steps.flatMap((s) => s.items.map((tx) => ({ id: s.id, tx })));
  const [done, setDone] = useState(0);
  return (
    <ol className="sd-fund-steps" aria-label="Wallet steps">
      {actions.map((a, i) => {
        const state = i < done ? 'confirmed' : i === done ? 'active' : 'todo';
        return (
          <li key={`${a.id}-${i}`} data-state={state}>
            <div>
              <strong>
                {i + 1}. {STEP_LABEL[a.id] ?? a.id}
              </strong>
              <small>{STEP_HINT[a.id] ?? ''}</small>
            </div>
            {state === 'confirmed' ? <StatusPill tone="ok">Confirmed</StatusPill> : null}
            {state === 'todo' ? <StatusPill>Waiting</StatusPill> : null}
            {state === 'active' ? (
              <TxStepButton
                label={STEP_LABEL[a.id] ?? 'Sign'}
                tx={a.tx as RawTx}
                onBroadcast={(hash) => onReport(a.id as 'approve' | 'deposit', hash)}
                onConfirmed={() => setDone((d) => Math.max(d, i + 1))}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Invoice -> Relay quote -> approve/deposit -> status polling for one card operation (issue or top-up).
 * Success text appears only when the API reports `completed`.
 */
export function FundingSteps({
  operationId,
  balanceMicros,
  walletConnected,
  onCompleted,
}: {
  operationId: string;
  /** Wallet USDG balance in micros; undefined while unknown. */
  balanceMicros: bigint | undefined;
  walletConnected: boolean;
  onCompleted?: () => void;
}) {
  const f = useCardFunding(operationId);
  const pricing = useCardPricing();
  const now = useNow();
  const [lastReport, setLastReport] = useState<{ step: 'approve' | 'deposit'; txHash: Hash } | null>(null);
  const report = useCallback(
    (step: 'approve' | 'deposit', txHash: Hash) => {
      setLastReport({ step, txHash });
      f.reportStep({ step, txHash });
    },
    [f.reportStep],
  );

  const phase = f.view?.phase;
  useEffect(() => {
    if (phase === 'completed') onCompleted?.();
  }, [phase, onCompleted]);

  if (f.query.isPending) return <Skeleton height={180} />;
  if (f.query.isError || !f.op || !f.view) {
    return (
      <ErrorState
        title="Operation unavailable"
        message={f.query.error instanceof Error ? f.query.error.message : undefined}
        onRetry={() => void f.query.refetch()}
      />
    );
  }
  const { op, relay, view } = f;
  // A refunded order can never be paid again: drop its quote so the user re-quotes.
  const quoted =
    f.quoted && !(relay?.status === 'refund' && relay.id === f.quoted.relayOrderId) ? f.quoted : null;
  const inv = op.invoice;
  const left = inv ? countdown(inv.expiresAt, now) : null;
  const payable = view.phase === 'pay' || (view.phase === 'refund' && op.status === 'awaiting_payment');
  const quoteStale = quoted ? Date.parse(quoted.expiresAt) <= now : false;
  const short =
    quoted && balanceMicros !== undefined ? BigInt(quoted.originAmountMicros) > balanceMicros : false;

  return (
    <div className="sd-fund" data-phase={view.phase}>
      <div className="sd-fund-status" role="status" aria-live="polite">
        <StatusPill tone={view.tone}>{view.phase === 'completed' ? 'Completed' : view.phase}</StatusPill>
        <span>{view.text}</span>
      </div>

      {inv ? (
        <dl className="sd-kv">
          <div>
            <dt>Card credit</dt>
            <dd>${formatCents(op.amountUsdCents)}</dd>
          </div>
          <div>
            <dt>izipay invoice</dt>
            <dd>
              {inv.payAmount} {inv.payCurrency.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{inv.network === 'tron' ? 'TRON' : 'BSC'}</dd>
          </div>
          <div>
            <dt>Invoice expires</dt>
            <dd>{op.status === 'awaiting_payment' ? (left ?? 'expired') : '—'}</dd>
          </div>
        </dl>
      ) : null}
      {inv && pricing.data ? <small className="sd-sub">{pricing.data.topupFeeNote}</small> : null}

      {payable && !quoted ? (
        <div className="sd-fund-pay">
          {!walletConnected ? <p className="sd-warn">Connect your wallet to pay with USDG.</p> : null}
          {f.quoteError ? (
            <p className="sd-warn" role="alert" data-kind={f.quoteError.kind}>
              {f.quoteError.message}
            </p>
          ) : null}
          <CTA icon="" disabled={f.quoting || !walletConnected} onClick={f.quote}>
            {f.quoting ? 'Getting quote…' : f.quoteError ? 'Try again' : 'Pay with USDG'}
          </CTA>
        </div>
      ) : null}

      {payable && quoted ? (
        <div className="sd-fund-quote">
          <dl className="sd-kv">
            <div>
              <dt>You pay</dt>
              <dd>{formatMicros(quoted.originAmountMicros)} USDG</dd>
            </div>
            <div>
              <dt>Relay fee (included)</dt>
              <dd>${quoted.feesUsd}</dd>
            </div>
            <div>
              <dt>Estimated time</dt>
              <dd>~{quoted.timeEstimateSec}s</dd>
            </div>
            <div>
              <dt>Your USDG</dt>
              <dd>{balanceMicros === undefined ? '—' : `${formatMicros(balanceMicros)} USDG`}</dd>
            </div>
          </dl>
          {short ? (
            <p className="sd-warn" role="alert">
              Not enough USDG in your wallet for this payment. Claim or receive more first.
            </p>
          ) : null}
          {quoteStale ? (
            <div className="sd-fund-pay">
              <p className="sd-warn">This quote expired. Nothing was sent.</p>
              <CTA icon="" disabled={f.quoting} onClick={f.quote}>
                Get a new quote
              </CTA>
            </div>
          ) : (
            <div className={short ? 'sd-fund-blocked' : undefined}>
              <StepRunner key={quoted.relayOrderId} quote={quoted} onReport={report} />
            </div>
          )}
          {f.reportError && lastReport ? (
            <p className="sd-warn" role="alert">
              Could not tell the server about your transaction ({f.reportError}). It is on-chain; retry to
              keep the status in sync.{' '}
              <button type="button" className="sd-link" onClick={() => f.reportStep(lastReport)}>
                Retry
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {view.phase === 'bridging' || view.phase === 'processing' ? (
        <p className="sd-sub">
          {relay?.depositTx ? (
            <a
              className="sp-tx-link"
              href={explorerTx(relay.depositTx)}
              target="_blank"
              rel="noreferrer noopener"
            >
              View deposit transaction
            </a>
          ) : null}{' '}
          You can leave this page; progress is saved.
        </p>
      ) : null}
      {view.phase === 'review' ? (
        <p className="sd-sub">We will update this page once the provider confirms. Support id: {op.id}</p>
      ) : null}
    </div>
  );
}
