import { useNavigate } from '@tanstack/react-router';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { CardFace } from '../../components/CardFace';
import { CTA } from '../../components/CTA';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Money } from '../../components/Money';
import { PixelIcon } from '../../components/PixelIcon';
import { Skeleton } from '../../components/Skeleton';
import { Stat } from '../../components/Stat';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { downloadStatement, useCards, useRecentReceipts, useSummary } from '../shell/queries';
import { Boundary, countdown, fmtTime, Panel, useNow } from '../shell/ui';

function ReceiveDialog({ open, onClose, address }: { open: boolean; onClose: () => void; address: string }) {
  const [qr, setQr] = useState('');
  const { toast } = useToast();
  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(address, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [open, address]);
  return (
    <Dialog open={open} onClose={onClose} title="Receive">
      <p>Send USDG on Robinhood Chain to this address. Other networks are not supported.</p>
      <div className="sd-qr">
        {qr ? (
          <img src={qr} alt="QR code of your wallet address" width={220} height={220} />
        ) : (
          <Skeleton width={220} height={220} />
        )}
      </div>
      <code className="sd-address">{address}</code>
      <CTA
        icon="copy"
        onClick={() =>
          void navigator.clipboard
            .writeText(address)
            .then(() => toast('Address copied', 'ok'))
            .catch(() => toast('Copy failed. Select the address and copy it manually.', 'error'))
        }
      >
        Copy address
      </CTA>
    </Dialog>
  );
}

function Balance() {
  const summary = useSummary();
  const auth = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const now = useNow();
  const [receive, setReceive] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = (action: string) => () =>
    void navigate({ to: '/dashboard/$tab', params: { tab: 'payments' }, search: { action } as never });
  return (
    <Panel title="Your balance" eyebrow="USDG account" className="sd-balance">
      <Boundary query={summary} title="Earnings" skeleton={<Skeleton height={140} />}>
        {(s) => {
          const wait = countdown(s.claimableAt, now);
          const next = countdown(s.nextEpochAt, now);
          const hasPending = BigInt(s.pendingMicros) > 0n;
          return (
            <>
              <div className="sd-balance-main">
                <Stat
                  label="Available to claim"
                  value={<Money micros={s.claimableMicros} />}
                  note={wait ? `claimable after 1h delay: ${wait}` : undefined}
                />
                <Stat
                  label="Pending"
                  value={<Money micros={s.pendingMicros} />}
                  note={hasPending ? `awaiting next root${next ? `, in ${next}` : ''}` : 'awaiting next root'}
                />
                <Stat
                  label="Total earned"
                  value={<Money micros={s.totalEarnedMicros} />}
                  note={
                    <>
                      min claim <Money micros={s.minClaimMicros} unit="USDG" />
                    </>
                  }
                />
              </div>
              <div className="sd-actions-row">
                <CTA icon="claim" onClick={go('claim')}>
                  Claim
                </CTA>
                <CTA variant="secondary" icon="receive" onClick={() => setReceive(true)}>
                  Receive
                </CTA>
                <CTA variant="secondary" icon="card-adapter" onClick={go('card')}>
                  Fund card
                </CTA>
                <CTA variant="secondary" icon="swap" onClick={go('swap')}>
                  Swap
                </CTA>
                <CTA
                  variant="secondary"
                  icon="download"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    downloadStatement()
                      .catch(() => toast('Statement export failed. Try again.', 'error'))
                      .finally(() => setBusy(false));
                  }}
                >
                  Statement
                </CTA>
              </div>
            </>
          );
        }}
      </Boundary>
      {auth.session ? (
        <ReceiveDialog open={receive} onClose={() => setReceive(false)} address={auth.session.address} />
      ) : null}
    </Panel>
  );
}

function CardPanel() {
  const cards = useCards();
  return (
    <Panel
      title="Your Spindle card"
      action={
        <CTA to="/dashboard/cards" variant="ghost">
          Manage
        </CTA>
      }
    >
      <Boundary query={cards} title="Cards" skeleton={<Skeleton height={160} />}>
        {(list) => {
          const c = list[0];
          if (!c) {
            return (
              <EmptyState
                icon="cards"
                title="No card yet"
                action={<CTA to="/dashboard/cards">Create a card</CTA>}
              >
                Spend your earnings anywhere. Issue a virtual card in a minute.
              </EmptyState>
            );
          }
          return (
            <div className="sd-card-preview">
              <CardFace finish={c.finish ?? 'orchid'} decorative />
              <div>
                <strong>{c.last4 ? `•••• ${c.last4}` : 'Pending issue'}</strong>
                <StatusPill tone={c.status === 'issued' ? 'ok' : c.status === 'failed' ? 'danger' : 'warn'}>
                  {c.status.replaceAll('_', ' ')}
                </StatusPill>
                <span>
                  Balance <Money micros={BigInt(c.balanceUsdCents) * 10_000n} unit="USD" />
                </span>
              </div>
            </div>
          );
        }}
      </Boundary>
    </Panel>
  );
}

function Recent() {
  const recent = useRecentReceipts(5);
  const navigate = useNavigate();
  return (
    <Panel
      title="Recent activity"
      eyebrow="The work behind your balance"
      action={
        <CTA to="/dashboard/activity" variant="ghost">
          View all
        </CTA>
      }
    >
      <Boundary query={recent} title="Recent activity" skeleton={<Skeleton height={140} />}>
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="Every job leaves a trace"
              action={<CTA to="/dashboard/compute">Open compute</CTA>}
            >
              Your verified activity will appear here.
            </EmptyState>
          ) : (
            <ul className="sd-list">
              {page.items.map((r) => (
                <li key={r.jobId}>
                  <button
                    type="button"
                    onClick={() => void navigate({ to: '/dashboard/$tab', params: { tab: 'activity' } })}
                  >
                    <span>
                      <strong>{r.model}</strong>
                      <small>
                        {r.nodeName} · {fmtTime(r.createdAt)}
                      </small>
                    </span>
                    <Money micros={r.providerMicros} />
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </Boundary>
    </Panel>
  );
}

function Nodes() {
  const summary = useSummary();
  return (
    <Panel
      title="Compute nodes"
      action={
        <CTA to="/dashboard/compute" variant="ghost">
          Open compute
        </CTA>
      }
    >
      <Boundary query={summary} title="Nodes" skeleton={<Skeleton height={48} />}>
        {(s) =>
          s.nodes.total === 0 ? (
            <EmptyState
              icon="nodes"
              title="No nodes yet"
              action={<CTA to="/dashboard/compute">Add a node</CTA>}
            >
              Supply GPU capacity to start earning.
            </EmptyState>
          ) : (
            <div className="sd-nodes">
              <PixelIcon name="nodes" size={24} />
              <Stat label="Online / total" value={`${s.nodes.online} / ${s.nodes.total}`} />
            </div>
          )
        }
      </Boundary>
    </Panel>
  );
}

export default function OverviewTab() {
  return (
    <div className="sd-overview">
      <h1>Overview</h1>
      <div className="sd-grid-2">
        <Balance />
        <CardPanel />
        <Recent />
        <Nodes />
      </div>
    </div>
  );
}
