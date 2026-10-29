import { spindleClaimsAbi } from '@spindle/shared/abi';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/errors';
import { useMe } from '../../api/hooks';
import { CTA } from '../../components/CTA';
import { formatMicros, Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { TxButton } from '../../components/TxButton';
import { env, explorerTx } from '../../config';
import { formatUnitsTrim, parseAmount } from '../card-funding/lib';
import { dk, useSummary } from '../shell/queries';
import { SettlementStages } from '../shell/Settlement';
import { Boundary } from '../shell/ui';
import { usePaymentsNav } from './nav';
import { useClaimProof } from './queries';

type Summary = NonNullable<ReturnType<typeof useSummary>['data']>;

function WhatNext() {
  const me = useMe();
  const go = usePaymentsNav();
  const pref = me.data?.prefs.afterClaim ?? 'keep';
  const opts = [
    { id: 'keep', title: 'Keep in wallet', text: 'Your USDG stays in your wallet. Nothing more to do.' },
    { id: 'card', title: 'Fund a card', text: 'Top up your virtual card from this USDG.' },
    { id: 'stock', title: 'Swap to a Stock Token', text: 'Buy a curated Stock Token with this USDG.' },
  ] as const;
  return (
    <section className="sd-next">
      <h3 className="sd-sub-h">What next?</h3>
      <ul>
        {opts.map((o) => (
          <li key={o.id} data-pref={pref === o.id}>
            <div>
              <strong>{o.title}</strong>
              {pref === o.id ? <em> · your default</em> : null}
              <small>{o.text}</small>
            </div>
            {o.id === 'card' ? (
              <CTA variant="secondary" icon="" onClick={() => go({ action: 'card' })}>
                Fund card
              </CTA>
            ) : null}
            {o.id === 'stock' ? (
              <CTA variant="secondary" icon="" onClick={() => go({ action: 'swap' })}>
                Swap
              </CTA>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Body({
  s,
  initialAmount,
  locked,
  onClaimed,
}: {
  s: Summary;
  initialAmount?: string;
  locked?: boolean;
  onClaimed?: (hash: `0x${string}`) => void;
}) {
  const qc = useQueryClient();
  const claimable = BigInt(s.claimableMicros);
  const min = BigInt(s.minClaimMicros);
  const [text, setText] = useState(initialAmount ?? formatUnitsTrim(claimable, 6).replaceAll(',', ''));
  useEffect(() => {
    if (initialAmount !== undefined) setText(initialAmount);
  }, [initialAmount]);
  const [done, setDone] = useState<{ hash: `0x${string}`; amount: bigint } | null>(null);

  const amount = parseAmount(text, 6);
  const tooMuch = amount !== null && amount > claimable;
  const tooLow = amount !== null && amount < min;
  const canAsk = amount !== null && amount > 0n && !tooMuch && !tooLow && claimable >= min && !done;
  const proof = useClaimProof(canAsk, amount?.toString() ?? '');
  const proofErr = proof.error instanceof ApiError ? proof.error : null;
  const chainState = proofErr?.code === 'CHAIN_STATE';
  const belowMin = chainState && (proofErr.details as { belowMinimum?: boolean } | undefined)?.belowMinimum;

  if (done) {
    return (
      <div className="sd-done" role="status">
        <strong>
          Claimed <Money micros={done.amount} /> to your wallet
        </strong>
        <a className="sp-tx-link" href={explorerTx(done.hash)} target="_blank" rel="noreferrer noopener">
          View transaction
        </a>
        {locked ? null : <WhatNext />}
      </div>
    );
  }

  let note: string | null = null;
  if (claimable === 0n || chainState) {
    note = belowMin
      ? `Below the minimum claim of ${formatMicros(min)} USDG. Keep earning.`
      : BigInt(s.pendingMicros) > 0n
        ? 'Nothing claimable yet. The times above show when your pending earnings unlock.'
        : 'Nothing claimable yet. Earnings land in the next hourly root.';
  } else if (claimable < min) {
    note = `You can claim from ${formatMicros(min)} USDG. You have ${formatMicros(claimable)} USDG claimable.`;
  } else if (tooLow) note = `Minimum claim is ${formatMicros(min)} USDG.`;
  else if (tooMuch) note = `You can claim at most ${formatMicros(claimable)} USDG.`;
  else if (amount === null && text !== '') note = 'Enter an amount with up to 6 decimals.';

  const p = proof.data;
  const stale = p && amount !== null && amount > BigInt(p.claimableMicros);
  return (
    <>
      <SettlementStages s={s} />
      <p className="sd-sub">
        Minimum claim <Money micros={s.minClaimMicros} />. Earnings go into an hourly root, then unlock 1h after it
        is posted.
      </p>
      <div className="sd-field">
        <label htmlFor="claim-amount">Amount to claim (USDG)</label>
        <div className="sd-amount-row">
          <input
            id="claim-amount"
            className="sd-input"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            readOnly={locked}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={!!note}
          />
          {locked ? null : (
            <button
              type="button"
              className="sd-link"
              onClick={() => setText(formatUnitsTrim(claimable, 6).replaceAll(',', ''))}
            >
              Max
            </button>
          )}
        </div>
      </div>
      <p className="sd-sub">
        USDG is sent to your wallet first and you pay the gas for the claim. From there you can fund a card or
        swap.
      </p>
      {note ? (
        <p className="sd-warn" role="status">
          {note}
        </p>
      ) : null}
      {proof.isFetching ? <Skeleton height={44} /> : null}
      {proof.isError && !chainState ? (
        <p className="sd-warn" role="alert">
          Could not load the claim proof. {proof.error instanceof Error ? proof.error.message : ''}{' '}
          <button type="button" className="sd-link" onClick={() => void proof.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      {stale ? (
        <p className="sd-warn" role="alert">
          The claimable amount changed. Lower the amount to {formatMicros(p.claimableMicros)} USDG or less.
        </p>
      ) : null}
      {p && amount !== null && !stale ? (
        <TxButton
          label={`Claim ${formatMicros(amount)} USDG`}
          request={{
            address: env.addresses.claims,
            abi: spindleClaimsAbi,
            functionName: 'claim',
            args: [BigInt(p.epoch), BigInt(p.cumulativeMicros), p.proof, amount],
          }}
          onConfirmed={(r) => {
            setDone({ hash: r.transactionHash, amount });
            void qc.invalidateQueries({ queryKey: dk.summary });
            void qc.invalidateQueries({ queryKey: dk.claims });
            void qc.invalidateQueries({ queryKey: ['app', 'earnings'] });
            void qc.invalidateQueries({ queryKey: ['readContract'] });
            onClaimed?.(r.transactionHash);
          }}
        />
      ) : (
        <CTA icon="" disabled>
          Claim {amount !== null && amount > 0n ? `${formatMicros(amount)} USDG` : 'USDG'}
        </CTA>
      )}
    </>
  );
}

export function ClaimForm(props: {
  initialAmount?: string;
  locked?: boolean;
  onClaimed?: (hash: `0x${string}`) => void;
}) {
  const summary = useSummary();
  return (
    <Boundary query={summary} title="Earnings" skeleton={<Skeleton height={220} />}>
      {(s) => <Body s={s} {...props} />}
    </Boundary>
  );
}
