import { type ReactNode, useMemo, useState } from 'react';
import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { type Column, Table } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { env, explorerTx } from '../../config';
import { downloadStatement, useClaims, useLatestEpoch, useLedger, useSeries } from '../shell/queries';
import { Boundary, fmtTime, Panel, shortHash } from '../shell/ui';

type Range = '7d' | '30d' | '90d';
type Bucket = { ts: string; jobMicros: string; floorMicros: string; slashMicros: string };

const W = 640;
const H = 220;
const PAD = { l: 8, r: 8, t: 10, b: 24 };

/** Stacked job/floor/slash bars. Heights use bigint ratios scaled to integers; no float money. */
function SeriesChart({ buckets }: { buckets: Bucket[] }) {
  const { bars, max } = useMemo(() => {
    let max = 0n;
    const bars = buckets.map((b) => {
      const job = BigInt(b.jobMicros);
      const floor = BigInt(b.floorMicros);
      const slash = BigInt(b.slashMicros);
      const total = job + floor + slash;
      if (total > max) max = total;
      return { b, job, floor, slash, total };
    });
    return { bars, max };
  }, [buckets]);
  if (max === 0n) {
    return (
      <EmptyState icon="earnings" title="No earnings in this range">
        Completed jobs show up here.
      </EmptyState>
    );
  }
  const inner = H - PAD.t - PAD.b;
  const slot = (W - PAD.l - PAD.r) / bars.length;
  const bw = Math.max(2, slot * 0.7);
  const px = (v: bigint) => (Number((v * 10000n) / max) / 10000) * inner;
  const total = bars.reduce((a, x) => a + x.job + x.floor + x.slash, 0n);
  return (
    <figure className="sd-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Earnings by day, total ${total.toString()} micro USDG`}
        preserveAspectRatio="none"
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--sp-line)" />
        {bars.map((x, i) => {
          const cx = PAD.l + i * slot + (slot - bw) / 2;
          let y = H - PAD.b;
          const seg = (v: bigint, cls: string) => {
            const h = px(v);
            y -= h;
            return h > 0 ? (
              <rect key={cls} className={cls} x={cx} y={y} width={bw} height={h}>
                <title>{`${fmtTime(x.b.ts)}: ${cls.replace('sd-bar-', '')} ${v.toString()} micros`}</title>
              </rect>
            ) : null;
          };
          return (
            <g key={x.b.ts}>
              {seg(x.job, 'sd-bar-job')}
              {seg(x.floor, 'sd-bar-floor')}
              {seg(x.slash, 'sd-bar-slash')}
            </g>
          );
        })}
        <text x={PAD.l} y={H - 6} className="sd-axis">
          {new Date(bars[0]?.b.ts ?? 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="sd-axis">
          {new Date(bars.at(-1)?.b.ts ?? 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </text>
      </svg>
      <figcaption className="sd-legend">
        <span>
          <i className="sd-dot-job" />
          Jobs <Money micros={bars.reduce((a, x) => a + x.job, 0n)} />
        </span>
        <span>
          <i className="sd-dot-floor" />
          Floor <Money micros={bars.reduce((a, x) => a + x.floor, 0n)} />
        </span>
        <span>
          <i className="sd-dot-slash" />
          Slash <Money micros={bars.reduce((a, x) => a + x.slash, 0n)} />
        </span>
      </figcaption>
    </figure>
  );
}

function Series() {
  const [range, setRange] = useState<Range>('7d');
  const q = useSeries(range);
  return (
    <Panel
      title="Earnings"
      eyebrow="Job, floor and slash"
      action={
        <div className="sd-seg" role="group" aria-label="Range">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      }
    >
      <Boundary query={q} title="Earnings series" skeleton={<Skeleton height={220} />}>
        {(d) => <SeriesChart buckets={d.buckets} />}
      </Boundary>
    </Panel>
  );
}

function Epochs() {
  const epoch = useLatestEpoch();
  const claims = useClaims();
  const treeUrl = (n: number) => `${env.apiUrl}/v1/epochs/${n}/tree`;
  return (
    <Panel title="Epochs and claims" eyebrow="Hourly Merkle roots">
      <Boundary query={epoch} title="Epoch" skeleton={<Skeleton height={64} />}>
        {(e) =>
          e === null ? (
            <EmptyState icon="epoch" title="No epoch posted yet">
              The first root is posted after the first hour of verified work.
            </EmptyState>
          ) : (
            <dl className="sd-kv">
              <div>
                <dt>Latest epoch</dt>
                <dd>#{e.epoch}</dd>
              </div>
              <div>
                <dt>Root</dt>
                <dd>
                  <code>{shortHash(e.root)}</code>
                </dd>
              </div>
              <div>
                <dt>Posted</dt>
                <dd>{e.postedAt ? fmtTime(e.postedAt) : 'not yet posted'}</dd>
              </div>
              <div>
                <dt>Transaction</dt>
                <dd>
                  {e.txHash ? (
                    <a href={explorerTx(e.txHash)} target="_blank" rel="noreferrer noopener">
                      {shortHash(e.txHash)}
                    </a>
                  ) : (
                    'none'
                  )}
                </dd>
              </div>
              <div>
                <dt>Tree</dt>
                <dd>
                  <a href={treeUrl(e.epoch)} target="_blank" rel="noreferrer noopener">
                    epoch {e.epoch} tree
                  </a>
                </dd>
              </div>
            </dl>
          )
        }
      </Boundary>
      <h3 className="sd-sub">Your claims</h3>
      <Boundary query={claims} title="Claims" skeleton={<Skeleton height={80} />}>
        {(p) => {
          const cols: Column<(typeof p.items)[number]>[] = [
            { key: 'epoch', header: 'Epoch', render: (r) => `#${r.epoch}` },
            {
              key: 'amt',
              header: 'Amount',
              align: 'right',
              render: (r) => <Money micros={r.amountMicros} />,
            },
            {
              key: 'st',
              header: 'Status',
              render: (r) => (
                <StatusPill
                  tone={r.status === 'confirmed' ? 'ok' : r.status === 'failed' ? 'danger' : 'warn'}
                >
                  {r.status}
                </StatusPill>
              ),
            },
            {
              key: 'tx',
              header: 'Transaction',
              render: (r) =>
                r.txHash ? (
                  <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer noopener">
                    {shortHash(r.txHash)}
                  </a>
                ) : (
                  'none'
                ),
            },
            { key: 'at', header: 'Created', render: (r) => fmtTime(r.createdAt) },
          ];
          return (
            <Table
              caption="Claims"
              columns={cols}
              rows={p.items}
              rowKey={(r) => r.id}
              empty={
                <EmptyState icon="claim" title="No claims yet">
                  Claim your first payout from the Payments tab.
                </EmptyState>
              }
            />
          );
        }}
      </Boundary>
    </Panel>
  );
}

function Ledger() {
  const q = useLedger();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'ts', header: 'Time', render: (r) => fmtTime(r.ts) },
    {
      key: 'kind',
      header: 'Type',
      render: (r) => (
        <StatusPill tone={r.kind === 'job' || r.kind === 'floor' ? 'ok' : 'danger'}>
          {r.kind.replace('_', ' ')}
        </StatusPill>
      ),
    },
    { key: 'node', header: 'Node', render: (r) => r.nodeId },
    { key: 'ep', header: 'Epoch', render: (r) => (r.epoch === null ? 'pending' : `#${r.epoch}`) },
    { key: 'm', header: 'Amount', align: 'right', render: (r) => <Money micros={r.micros} /> },
  ];
  let body: ReactNode;
  if (q.isPending) body = <Skeleton height={200} />;
  else if (q.isError)
    body = (
      <ErrorState title="Ledger unavailable" message={q.error.message} onRetry={() => void q.refetch()} />
    );
  else {
    body = (
      <>
        <Table
          caption="Earnings ledger"
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState icon="ledger" title="No ledger entries">
              Earnings appear after your first verified job.
            </EmptyState>
          }
        />
        {q.hasNextPage ? (
          <CTA
            variant="secondary"
            icon=""
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? 'Loading' : 'Load more'}
          </CTA>
        ) : null}
      </>
    );
  }
  return (
    <Panel
      title="Ledger"
      eyebrow="Every earning event"
      action={
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
          Export CSV
        </CTA>
      }
    >
      {body}
    </Panel>
  );
}

export default function AccountsTab() {
  return (
    <div className="sd-overview">
      <h1>Accounts</h1>
      <Series />
      <Epochs />
      <Ledger />
    </div>
  );
}
