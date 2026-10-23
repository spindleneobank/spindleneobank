import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useMe } from '../../api/hooks';
import { CardFace } from '../../components/CardFace';
import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { formatCents } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { Boundary, PageHead } from '../shell/ui';
import { ApplePayDialog, CreateCardDialog, RevealDialog, TopupDialog } from './Dialogs';
import { type CardItem, statusLabel, statusTone } from './logic';
import { useCardList, useCardPricing } from './queries';
import { Tracker } from './Tracker';
import { Transactions } from './Transactions';
import './cards.css';

export default function CardsTab() {
  const cards = useCardList();
  const me = useMe();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { op?: string; card?: string };
  const opId = typeof search.op === 'string' ? search.op : null;
  const opCard = typeof search.card === 'string' ? search.card : null;
  const [creating, setCreating] = useState(false);
  const [topup, setTopup] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [apple, setApple] = useState<string | null>(null);
  const [txOpen, setTxOpen] = useState<string | null>(null);
  const defaultFinish = me.data?.prefs.cardFinish ?? 'orchid';

  const openOp = (id: string | null, cardId?: string) =>
    void navigate({
      to: '/dashboard/$tab',
      params: { tab: 'cards' },
      search: id ? { op: id, ...(cardId ? { card: cardId } : {}) } : {},
    } as never);
  const trackedCard = cards.data?.find((c) => (opCard ? c.id === opCard : c.pendingOperation?.id === opId));

  return (
    <div className="sd-overview">
      <PageHead eyebrow="VIRTUAL CARD" line1="Spend your earnings." line2="Anywhere Mastercard works.">
        Create a virtual card, fund it with USDG, <br />
        and add it to Apple Pay.
      </PageHead>

      {opId ? <Tracker opId={opId} card={trackedCard} onClose={() => openOp(null)} /> : null}

      <Boundary query={cards} title="Cards" skeleton={<Skeleton height={320} />}>
        {(list) =>
          list.length === 0 ? (
            <EmptyCards onCreate={() => setCreating(true)} defaultFinish={defaultFinish} />
          ) : (
            <>
              <div className="cd-head">
                <h2>Your cards</h2>
                <CTA variant="secondary" icon="" onClick={() => setCreating(true)}>
                  Create card
                </CTA>
              </div>
              <ul className="cd-grid">
                {list.map((c) => (
                  <li key={c.id}>
                    <CardBox
                      card={c}
                      fallbackFinish={defaultFinish}
                      txOpen={txOpen === c.id}
                      onTx={() => setTxOpen(txOpen === c.id ? null : c.id)}
                      onTopup={() => setTopup(c.id)}
                      onReveal={() => setReveal(c.id)}
                      onApple={() => setApple(c.id)}
                      onTrack={(id) => openOp(id, c.id)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </Boundary>

      <CreateCardDialog
        open={creating}
        onClose={() => setCreating(false)}
        defaultFinish={defaultFinish}
        onCreated={openOp}
      />
      <TopupDialog cardId={topup} onClose={() => setTopup(null)} onCreated={openOp} />
      <RevealDialog cardId={reveal} onClose={() => setReveal(null)} />
      <ApplePayDialog cardId={apple} onClose={() => setApple(null)} />
    </div>
  );
}

function EmptyCards({ onCreate, defaultFinish }: { onCreate: () => void; defaultFinish: string }) {
  const pricing = useCardPricing();
  const fee = pricing.data?.products.find((p) => p.available)?.issueFeeUsdCents;
  return (
    <section className="sd-box cd-empty">
      <div className="sd-card-art">
        <CardFace finish={defaultFinish} decorative />
      </div>
      <EmptyState
        icon="cards"
        title="Create your virtual card"
        action={
          <CTA icon="" onClick={onCreate}>
            Create card
          </CTA>
        }
      >
        {fee
          ? `A one-time issue fee of $${formatCents(fee)} applies, paid in USDG.`
          : 'Pay the issue fee in USDG.'}{' '}
        Add it to Apple Pay once it is issued.
      </EmptyState>
    </section>
  );
}

function CardBox({
  card,
  fallbackFinish,
  txOpen,
  onTx,
  onTopup,
  onReveal,
  onApple,
  onTrack,
}: {
  card: CardItem;
  fallbackFinish: string;
  txOpen: boolean;
  onTx: () => void;
  onTopup: () => void;
  onReveal: () => void;
  onApple: () => void;
  onTrack: (id: string) => void;
}) {
  const issued = card.status === 'issued';
  const pending = card.pendingOperation;
  return (
    <article className="sd-box cd-card" aria-label={`Card ${card.last4 ?? 'pending'}`}>
      <div className="sd-card-art">
        <CardFace finish={card.finish ?? fallbackFinish} decorative />
      </div>
      <div className="sd-card-meta">
        <strong>{card.last4 ? `•••• ${card.last4}` : 'Not issued yet'}</strong>
        <StatusPill tone={statusTone(card.status)}>{statusLabel(card.status)}</StatusPill>
        <span>Balance ${formatCents(card.balanceUsdCents)}</span>
      </div>
      {pending ? (
        <div className="sd-banner cd-banner" role="status">
          <span>
            {pending.kind === 'issue' ? 'Card issue' : `Top-up of $${formatCents(pending.amountUsdCents)}`} in
            progress.
          </span>
          <CTA variant="secondary" icon="" onClick={() => onTrack(pending.id)}>
            View progress
          </CTA>
        </div>
      ) : null}
      <div className="sd-actions-row">
        {issued ? (
          <>
            <CTA variant="secondary" icon="" onClick={onTopup} disabled={!!pending}>
              Top up
            </CTA>
            <CTA variant="secondary" icon="" onClick={onReveal}>
              Show card details
            </CTA>
            {card.product === 'mastercard' ? (
              <CTA variant="secondary" icon="" onClick={onApple}>
                Add to Apple Pay
              </CTA>
            ) : null}
            <CTA variant="ghost" icon="" onClick={onTx} aria-expanded={txOpen}>
              {txOpen ? 'Hide transactions' : 'Transactions'}
            </CTA>
          </>
        ) : null}
      </div>
      {txOpen ? <Transactions cardId={card.id} /> : null}
    </article>
  );
}
