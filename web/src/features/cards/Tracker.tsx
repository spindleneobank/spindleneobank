import { useCallback, useState } from 'react';
import { CTA } from '../../components/CTA';
import { ErrorState } from '../../components/ErrorState';
import { formatCents, Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { explorerTx } from '../../config';
import { countdown, fmtTime, useNow } from '../shell/ui';
import { type CardItem, describeOp, friendlyError, trackerSteps } from './logic';
import { useCardOperation, useRelayQuote, useRelaySubmitted } from './queries';
import { RawTxButton } from './RawTxButton';

type Quote = NonNullable<ReturnType<typeof useRelayQuote>['data']>;

/** Operation tracker for an issue or top-up. Drives everything from the backend operation + relay order. */
export function Tracker({ opId, card, onClose }: { opId: string; card?: CardItem; onClose: () => void }) {
  const q = useCardOperation(opId);
  const now = useNow(1000);
  if (q.isPending)
    return (
      <TrackerShell onClose={onClose}>
        <Skeleton height={160} />
      </TrackerShell>
    );
  if (q.isError || !q.data) {
    return (
      <TrackerShell onClose={onClose}>
        <ErrorState
          title="Operation unavailable"
          message={friendlyError(q.error)}
          onRetry={() => void q.refetch()}
        />
      </TrackerShell>
    );
  }
  const { operation: op, relay } = q.data;
  const view = describeOp(op, relay, card?.status, now);
  const steps = trackerSteps(view, op);
  const expires = op.invoice ? countdown(op.invoice.expiresAt, now) : null;
  return (
    <TrackerShell onClose={onClose} kind={op.kind} amount={op.amountUsdCents}>
      <ol className="cd-steps" aria-label="Progress">
        {steps.map((s) => (
          <li key={s.label} data-state={s.state}>
            <i aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ol>
      <div className="cd-status" data-phase={view.phase} role="status">
        <StatusPill tone={view.tone}>{view.title}</StatusPill>
        <p>{view.text}</p>
        {view.phase === 'failed' || view.phase === 'review' ? (
          <small className="cd-support">Support reference: {op.id}</small>
        ) : null}
        {relay?.depositTx ? (
          <a className="sd-link" href={explorerTx(relay.depositTx)} target="_blank" rel="noreferrer noopener">
            View bridge transaction
          </a>
        ) : null}
      </div>
      {op.invoice && !['completed', 'failed'].includes(op.status) ? (
        <dl className="sd-kv">
          <div>
            <dt>Invoice</dt>
            <dd>
              {op.invoice.payAmount} {op.invoice.payCurrency.toUpperCase()} on{' '}
              {op.invoice.network.toUpperCase()}
            </dd>
          </div>
          <div>
            <dt>{op.kind === 'issue' ? 'Card amount' : 'Top-up amount'}</dt>
            <dd>${formatCents(op.amountUsdCents)}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{expires ? `in ${expires}` : fmtTime(op.invoice.expiresAt)}</dd>
          </div>
        </dl>
      ) : null}
      {view.canPay ? <PayPanel key={op.id} opId={op.id} /> : null}
      {view.phase === 'expired' || view.phase === 'failed' || view.phase === 'refunded' ? (
        <div className="sd-actions-row">
          <CTA variant="secondary" icon="" onClick={onClose}>
            Back to cards
          </CTA>
        </div>
      ) : null}
    </TrackerShell>
  );
}

function TrackerShell({
  children,
  onClose,
  kind,
  amount,
}: {
  children: React.ReactNode;
  onClose: () => void;
  kind?: 'issue' | 'topup';
  amount?: string;
}) {
  return (
    <section className="sd-box cd-tracker" aria-label="Operation tracker">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">
            {kind === 'topup' ? 'TOP-UP' : kind === 'issue' ? 'NEW CARD' : 'OPERATION'}
          </span>
          <h2>
            {kind === 'topup'
              ? `Top up $${formatCents(amount ?? '0')}`
              : kind === 'issue'
                ? 'Issue your virtual card'
                : 'Card operation'}
          </h2>
        </div>
        <CTA variant="ghost" icon="" onClick={onClose}>
          Close
        </CTA>
      </div>
      {children}
    </section>
  );
}

/** Quote then approve -> deposit. Each tx is reported to the API only after its receipt succeeds. */
function PayPanel({ opId }: { opId: string }) {
  const quote = useRelayQuote(opId);
  const submitted = useRelaySubmitted(opId);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const now = useNow(1000);
  const q: Quote | undefined = quote.data;

  const report = useCallback(
    (step: 'approve' | 'deposit', hash: string) => {
      if (!q) return;
      submitted.mutate(
        { relayOrderId: q.relayOrderId, step, txHash: hash },
        { onSuccess: () => setDone((d) => ({ ...d, [step]: true })) },
      );
    },
    [q, submitted],
  );

  if (!q) {
    return (
      <div className="cd-pay">
        <CTA icon="" disabled={quote.isPending} onClick={() => quote.mutate()}>
          {quote.isPending ? 'Getting quote…' : 'Get quote'}
        </CTA>
        {quote.isError ? (
          <p className="cd-error" role="alert">
            {friendlyError(quote.error)}
          </p>
        ) : null}
      </div>
    );
  }
  const stale = Date.parse(q.expiresAt) <= now && !done.deposit;
  const items = q.steps.flatMap((s) => s.items.map((it, i) => ({ id: s.id, key: `${s.id}-${i}`, it })));
  const prevDone = (id: string) => {
    const idx = items.findIndex((x) => x.id === id);
    return items.slice(0, idx).every((x) => done[x.id]);
  };
  return (
    <div className="cd-pay">
      <dl className="sd-kv">
        <div>
          <dt>You pay</dt>
          <dd>
            <Money micros={q.originAmountMicros} unit="USDG" />
          </dd>
        </div>
        <div>
          <dt>Relay fee</dt>
          <dd>${q.feesUsd}</dd>
        </div>
        <div>
          <dt>Estimated time</dt>
          <dd>~{q.timeEstimateSec}s</dd>
        </div>
      </dl>
      {stale ? (
        <div className="cd-stale">
          <p>This quote expired. Get a fresh one before paying.</p>
          <CTA
            variant="secondary"
            icon=""
            onClick={() => quote.mutate(undefined, { onSuccess: () => setDone({}) })}
          >
            Refresh quote
          </CTA>
        </div>
      ) : (
        <ol className="cd-txsteps">
          {items.map((x, n) => (
            <li key={x.key}>
              <span className="cd-txn">{n + 1}</span>
              <RawTxButton
                label={x.id === 'approve' ? 'Approve USDG' : 'Send payment'}
                tx={x.it}
                disabled={!prevDone(x.id) || !!done[x.id]}
                onConfirmed={(h) => report(x.id === 'approve' ? 'approve' : 'deposit', h)}
              />
            </li>
          ))}
        </ol>
      )}
      {submitted.isError ? (
        <p className="cd-error" role="alert">
          {friendlyError(submitted.error)}
        </p>
      ) : null}
      {done.deposit ? <small>Payment sent. Waiting for the bridge to confirm.</small> : null}
    </div>
  );
}
