import { useState } from 'react';
import { ApiError } from '../../api/errors';
import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { formatCents, formatMicros } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { useCardPricing, useCreateTopup, useUsdgBalance } from '../card-funding/api';
import { FundingSteps } from '../card-funding/FundingSteps';
import { parseAmount } from '../card-funding/lib';
import { useCards } from '../shell/queries';
import { Boundary } from '../shell/ui';

/** Select card + USD amount -> create top-up operation -> FundingSteps. `opId` lives in the URL (or wizard). */
export function FundForm({
  opId,
  onOp,
  onReset,
  initialCardId,
  initialAmount,
  locked,
  onCompleted,
}: {
  opId: string | undefined;
  onOp: (id: string) => void;
  onReset: () => void;
  initialCardId?: string;
  initialAmount?: string;
  locked?: boolean;
  onCompleted?: () => void;
}) {
  const cards = useCards();
  const pricing = useCardPricing();
  const bal = useUsdgBalance();
  const create = useCreateTopup();
  const [cardId, setCardId] = useState(initialCardId ?? '');
  const [text, setText] = useState(initialAmount ?? '');

  return (
    <Boundary query={cards} title="Cards" skeleton={<Skeleton height={220} />}>
      {(list) => {
        const usable = list.filter((c) => c.status === 'issued');
        const card = usable.find((c) => c.id === cardId) ?? (opId ? undefined : usable[0]);
        if (!opId && usable.length === 0) {
          return (
            <EmptyState
              icon="cards"
              title="No card to fund yet"
              action={
                <CTA variant="secondary" icon="" to="/dashboard/cards">
                  Go to Cards
                </CTA>
              }
            >
              Create a virtual card first, then come back to top it up with USDG.
            </EmptyState>
          );
        }
        // parseAmount(…, 2) yields hundredths of a dollar, i.e. integer cents.
        const cents = parseAmount(text, 2);
        const min = pricing.data ? BigInt(pricing.data.minTopupCents) : 0n;
        const max = pricing.data ? BigInt(pricing.data.maxTopupCents) : 0n;
        const rangeErr =
          cents !== null && pricing.data && (cents < min || cents > max)
            ? `Enter between $${formatCents(min)} and $${formatCents(max)}.`
            : null;
        const centsOk = cents !== null && cents > 0n && !rangeErr;
        const pending = card?.pendingOperation;
        return (
          <>
            <p className="sd-sub">
              Wallet USDG:{' '}
              <strong>
                {!bal.connected
                  ? 'connect your wallet'
                  : bal.data === undefined
                    ? '…'
                    : `${formatMicros(bal.data)} USDG`}
              </strong>
            </p>
            {opId ? (
              <>
                <FundingSteps
                  operationId={opId}
                  balanceMicros={bal.data}
                  walletConnected={bal.connected}
                  onCompleted={onCompleted}
                />
                {locked ? null : (
                  <CTA variant="ghost" icon="" onClick={onReset}>
                    Start a new top-up
                  </CTA>
                )}
              </>
            ) : (
              <>
                <fieldset className="sd-field">
                  <legend>Card</legend>
                  <div className="sd-seg" role="radiogroup" aria-label="Card">
                    {usable.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={card?.id === c.id}
                        disabled={locked && c.id !== card?.id}
                        onClick={() => setCardId(c.id)}
                      >
                        •••• {c.last4 ?? '----'} · ${formatCents(c.balanceUsdCents)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {pending ? (
                  <div className="sd-warn" role="status">
                    This card already has an open top-up invoice.{' '}
                    <button type="button" className="sd-link" onClick={() => onOp(pending.id)}>
                      Resume it
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="sd-field">
                      <label htmlFor="fund-amount">Top up amount (USD)</label>
                      <input
                        id="fund-amount"
                        className="sd-input"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="25.00"
                        value={text}
                        readOnly={locked}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </div>
                    {rangeErr ? <p className="sd-warn">{rangeErr}</p> : null}
                    {create.isError ? (
                      <p className="sd-warn" role="alert">
                        {create.error instanceof ApiError && create.error.code === 'LIVE_WRITES_DISABLED'
                          ? 'Card top-ups are disabled in this environment.'
                          : create.error.message}
                      </p>
                    ) : null}
                    <CTA
                      icon=""
                      disabled={!card || !centsOk || create.isPending}
                      onClick={() => {
                        if (!card || cents === null) return;
                        create.mutate(
                          { cardId: card.id, amountUsdCents: cents.toString() },
                          { onSuccess: (r) => onOp(r.operation.id) },
                        );
                      }}
                    >
                      {create.isPending ? 'Creating invoice…' : 'Create invoice'}
                    </CTA>
                    <p className="sd-sub">
                      An invoice is created once and shown with izipay's exact amounts. You then pay it with
                      USDG through Relay.
                    </p>
                  </>
                )}
              </>
            )}
          </>
        );
      }}
    </Boundary>
  );
}
