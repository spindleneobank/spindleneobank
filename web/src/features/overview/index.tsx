import { useNavigate } from '@tanstack/react-router';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useMe } from '../../api/hooks';
import { useAuth } from '../../auth/useAuth';
import { CardFace, CardFinishPicker } from '../../components/CardFace';
import { CTA } from '../../components/CTA';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Money } from '../../components/Money';
import { PixelIcon } from '../../components/PixelIcon';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { downloadStatement, useCards, useRecentReceipts, useSummary } from '../shell/queries';
import { Boundary, countdown, fmtTime, PageHead, useNow } from '../shell/ui';

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
    <section className="sd-box sd-balance">
      <div className="sd-box-top">
        <span className="sd-mono">
          <PixelIcon name="wallet" size={18} /> USDG ACCOUNT
        </span>
        <button
          type="button"
          className="sd-bare"
          aria-label="View account details"
          onClick={() => void navigate({ to: '/dashboard/$tab', params: { tab: 'accounts' } })}
        >
          <PixelIcon name="external" size={18} />
        </button>
      </div>
      <Boundary query={summary} title="Earnings" skeleton={<Skeleton height={150} />}>
        {(s) => {
          const wait = countdown(s.claimableAt, now);
          const next = countdown(s.nextEpochAt, now);
          return (
            <>
              <span className="sd-label">Available to claim</span>
              <strong className="sd-amount">
                <Money micros={s.claimableMicros} />
              </strong>
              <span className="sd-sub">
                Pending <Money micros={s.pendingMicros} /> awaiting next root{next ? ` (${next})` : ''}
                {' · '}Total earned <Money micros={s.totalEarnedMicros} />
              </span>
              {wait ? <span className="sd-sub">Claimable after 1h delay: {wait}</span> : null}
              <div className="sd-money-actions">
                <button type="button" onClick={go('claim')}>
                  <PixelIcon name="claim" size={20} />
                  <span>Claim</span>
                </button>
                <button type="button" onClick={() => setReceive(true)}>
                  <PixelIcon name="receive" size={20} />
                  <span>Receive</span>
                </button>
                <button type="button" onClick={go('card')}>
                  <PixelIcon name="cards" size={20} />
                  <span>Fund card</span>
                </button>
                <button type="button" onClick={go('swap')}>
                  <PixelIcon name="swap" size={20} />
                  <span>Swap</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    downloadStatement()
                      .catch(() => toast('Statement export failed. Try again.', 'error'))
                      .finally(() => setBusy(false));
                  }}
                >
                  <PixelIcon name="ledger" size={20} />
                  <span>Statement</span>
                </button>
              </div>
            </>
          );
        }}
      </Boundary>
      <div className="sd-box-bottom">
        <span>
          <PixelIcon name="receipt" size={14} /> Signed at the source
        </span>
        <span>
          <PixelIcon name="hourly" size={14} /> Hourly epochs
        </span>
      </div>
      {auth.session ? (
        <ReceiveDialog open={receive} onClose={() => setReceive(false)} address={auth.session.address} />
      ) : null}
    </section>
  );
}

function CardPanel() {
  const cards = useCards();
  const me = useMe();
  const [pick, setPick] = useState<string | null>(null);
  const c = cards.data?.[0];
  const finish = pick ?? c?.finish ?? me.data?.prefs.cardFinish ?? 'orchid';
  return (
    <section className="sd-box sd-cardbox">
      <div className="sd-box-top">
        <h2>Your Spindle card</h2>
        <CTA to="/dashboard/cards" variant="ghost">
          Manage
        </CTA>
      </div>
      <Boundary query={cards} title="Cards" skeleton={<Skeleton height={220} />}>
        {(list) => (
          <>
            <div className="sd-card-art">
              <CardFace finish={finish} decorative />
            </div>
            {list[0] ? (
              <div className="sd-card-meta">
                <strong>{list[0].last4 ? `•••• ${list[0].last4}` : 'Pending issue'}</strong>
                <StatusPill
                  tone={list[0].status === 'issued' ? 'ok' : list[0].status === 'failed' ? 'danger' : 'warn'}
                >
                  {list[0].status.replaceAll('_', ' ')}
                </StatusPill>
                <span>
                  Balance <Money micros={BigInt(list[0].balanceUsdCents) * 10_000n} unit="USD" />
                </span>
              </div>
            ) : (
              <div className="sd-card-meta">
                <span>No card yet.</span>
                <CTA to="/dashboard/cards" variant="secondary" icon="">
                  Create a card
                </CTA>
              </div>
            )}
            <CardFinishPicker value={finish} onChange={setPick} />
          </>
        )}
      </Boundary>
    </section>
  );
}

const TONES = ['', 'tone-1', 'tone-2', 'tone-3'];

function Recent() {
  const recent = useRecentReceipts(5);
  const navigate = useNavigate();
  return (
    <section className="sd-box sd-activity">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">THE WORK BEHIND YOUR BALANCE</span>
          <h2>Recent activity</h2>
        </div>
        <CTA to="/dashboard/activity" variant="ghost">
          View all
        </CTA>
      </div>
      <Boundary query={recent} title="Recent activity" skeleton={<Skeleton height={200} />}>
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="Every job leaves a trace"
              action={
                <CTA to="/dashboard/compute" variant="secondary" icon="arrow">
                  Open compute
                </CTA>
              }
            >
              Your verified activity will appear here.
            </EmptyState>
          ) : (
            <ul className="sd-feed">
              {page.items.map((r, i) => {
                const failed =
                  r.verified === false ||
                  r.status === 'failed' ||
                  r.status === 'timeout' ||
                  r.status === 'cancelled';
                return (
                  <li key={r.jobId}>
                    <button
                      type="button"
                      onClick={() => void navigate({ to: '/dashboard/$tab', params: { tab: 'activity' } })}
                    >
                      <i className={`sd-job-icon ${TONES[i % 4]}`}>
                        <PixelIcon name="receipt" size={16} />
                      </i>
                      <span className="sd-job">
                        <strong>{r.model}</strong>
                        <small>
                          {r.nodeName} · {fmtTime(r.createdAt)}
                        </small>
                      </span>
                      <StatusPill tone={failed ? 'danger' : r.verified ? 'ok' : 'warn'}>
                        {failed ? 'Failed' : r.verified ? 'Verified' : 'Pending'}
                      </StatusPill>
                      <span className={`sd-credit${failed ? ' is-failed' : ''}`}>
                        <Money micros={r.providerMicros} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Boundary>
    </section>
  );
}

function Breakdown() {
  const summary = useSummary();
  return (
    <section className="sd-box sd-breakdown">
      <div className="sd-box-top">
        <h2>Account breakdown</h2>
        <PixelIcon name="stack" size={21} />
      </div>
      <Boundary query={summary} title="Breakdown" skeleton={<Skeleton height={120} />}>
        {(s) => {
          const claimable = BigInt(s.claimableMicros);
          const pending = BigInt(s.pendingMicros);
          const total = claimable + pending;
          const pct = total === 0n ? 0 : Number((claimable * 10000n) / total) / 100;
          return (
            <>
              <div className="sd-map-value">
                <Money micros={total} />
              </div>
              <div className="sd-map-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="sd-map-key">
                <span>
                  <i />
                  Available
                  <strong>
                    <Money micros={s.claimableMicros} unit={null} />
                  </strong>
                </span>
                <span>
                  <i />
                  Awaiting claim epoch
                  <strong>
                    <Money micros={s.pendingMicros} unit={null} />
                  </strong>
                </span>
              </div>
              <p>Verified receipts create the record.</p>
            </>
          );
        }}
      </Boundary>
    </section>
  );
}

function Compute() {
  const summary = useSummary();
  return (
    <section className="sd-box sd-compute">
      <div className="sd-box-top">
        <h2>Powering the balance</h2>
        <PixelIcon name="nodes" size={21} />
      </div>
      <Boundary query={summary} title="Nodes" skeleton={<Skeleton height={64} />}>
        {(s) => (
          <div className="sd-compute-value">
            <strong>{s.nodes.total === 0 ? '—' : s.nodes.total}</strong>
            <span>
              GPU nodes <br />
              <small>{s.nodes.total === 0 ? 'Your compute supply' : `${s.nodes.online} online`}</small>
            </span>
          </div>
        )}
      </Boundary>
      <CTA to="/dashboard/compute" variant="ghost">
        Open compute workspace
      </CTA>
    </section>
  );
}

export default function OverviewTab() {
  return (
    <div className="sd-overview">
      <PageHead eyebrow="COMPUTE TO CAPITAL" line1="Your money." line2="A different kind of energy.">
        Earn through verified GPU work. <br />
        Choose where it takes you next.
      </PageHead>
      <div className="sd-ov-grid">
        <Balance />
        <CardPanel />
        <Recent />
        <aside className="sd-right">
          <Breakdown />
          <Compute />
        </aside>
        <div className="sd-flow">
          <span>
            <PixelIcon name="gpu" size={25} />
            <b>COMPUTE</b>
            <small>Supply suitable GPU capacity</small>
          </span>
          <i>→</i>
          <span>
            <PixelIcon name="proof" size={25} />
            <b>VERIFY</b>
            <small>Signed work. Clear receipts.</small>
          </span>
          <i>→</i>
          <span>
            <PixelIcon name="payouts" size={25} />
            <b>CHOOSE</b>
            <small>USDG, stock tokens or a card</small>
          </span>
        </div>
      </div>
    </div>
  );
}
