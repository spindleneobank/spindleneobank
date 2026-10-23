import { type ReactNode, useMemo, useState } from 'react';
import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { formatMicros, Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { env, explorerTx } from '../../config';
import { downloadStatement, useClaims, useEpochs, useLedger, useSeries } from '../shell/queries';
import { Boundary, fmtTime, PageHead, RowTable, shortHash } from '../shell/ui';

type Range = '7d' | '30d' | '90d';
type Bucket = { ts: string; jobMicros: string; floorMicros: string; slashMicros: string };

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Round a bigint up to a "nice" 1/2/5 x 10^n step so the y-axis has clean labels. */
function niceMax(v: bigint): bigint {
  if (v <= 0n) return 1_000_000n;
  let mag = 1n;
  while (mag * 10n <= v) mag *= 10n;
  for (const m of [1n, 2n, 5n, 10n]) if (mag * m >= v) return mag * m;
  return mag * 10n;
}

/** Stacked job/floor/slash bars (HTML, so axis text keeps its real size). Heights are bigint ratios. */
export function SeriesChart({ buckets }: { buckets: Bucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => {
    const bars = buckets.map((b) => {
      const job = BigInt(b.jobMicros);
      const floor = BigInt(b.floorMicros);
      const slash = BigInt(b.slashMicros);
      return { b, job, floor, slash, total: job + floor + slash };
    });
    const max = niceMax(bars.reduce((m, x) => (x.total > m ? x.total : m), 0n));
    return { bars, max };
  }, [buckets]);
  const { bars, max } = data;
  if (bars.every((x) => x.total === 0n)) {
    return (
      <EmptyState icon="earnings" title="No earnings in this range">
        Completed jobs show up here.
      </EmptyState>
    );
  }
  const pct = (v: bigint) => `${Number((v * 10000n) / max) / 100}%`;
  // keyed by quartile, not by value: small maxima make several tick values equal
  const ticks = [4n, 3n, 2n, 1n, 0n].map((i) => ({ q: i, v: (max * i) / 4n }));
  const sum = (k: 'job' | 'floor' | 'slash') => bars.reduce((a, x) => a + x[k], 0n);
  const labelAt = [
    0,
    Math.floor((bars.length - 1) / 3),
    Math.floor(((bars.length - 1) * 2) / 3),
    bars.length - 1,
  ];
  const h = hover === null ? null : bars[hover];
  return (
    <figure className="sd-chart">
      <div className="sd-plot">
        <div className="sd-yaxis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.q.toString()}>{formatMicros(t.v, { fractionDigits: 0 })}</span>
          ))}
        </div>
        <div className="sd-area">
          <div className="sd-grid-lines" aria-hidden="true">
            {ticks.map((t) => (
              <i key={t.q.toString()} />
            ))}
          </div>
          <div className="sd-bars">
            {bars.map((x, i) => (
              <button
                type="button"
                key={x.b.ts}
                className="sd-bar"
                aria-label={`${day(x.b.ts)}: ${formatMicros(x.total)} USDG`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span className="sd-seg-slash" style={{ height: pct(x.slash) }} />
                <span className="sd-seg-floor" style={{ height: pct(x.floor) }} />
                <span className="sd-seg-job" style={{ height: pct(x.job) }} />
              </button>
            ))}
          </div>
          {h && hover !== null ? (
            <div className="sd-tip" style={{ left: `${((hover + 0.5) / bars.length) * 100}%` }} role="status">
              <b>{day(h.b.ts)}</b>
              <span>
                <i className="sd-dot-job" />
                Jobs {formatMicros(h.job)}
              </span>
              <span>
                <i className="sd-dot-floor" />
                Floor {formatMicros(h.floor)}
              </span>
              <span>
                <i className="sd-dot-slash" />
                Slash {formatMicros(h.slash)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="sd-xaxis" aria-hidden="true">
        {labelAt.map((i, pos) => (
          // positions, not bar indexes: short ranges map several labels to the same bar
          // biome-ignore lint/suspicious/noArrayIndexKey: label slot is the stable identity
          <span key={`${pos}-${i}`}>{day(bars[i]?.b.ts ?? '')}</span>
        ))}
      </div>
      <figcaption className="sd-legend">
        <span>
          <i className="sd-dot-job" />
          Jobs <Money micros={sum('job')} />
        </span>
        <span>
          <i className="sd-dot-floor" />
          Floor <Money micros={sum('floor')} />
        </span>
        <span>
          <i className="sd-dot-slash" />
          Slash <Money micros={sum('slash')} />
        </span>
      </figcaption>
    </figure>
  );
}

function Box({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sd-box sd-flat">
      <div className="sd-box-top">
        <div>
          {eyebrow ? <span className="sd-eyebrow">{eyebrow}</span> : null}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Series() {
  const [range, setRange] = useState<Range>('7d');
  const q = useSeries(range);
  return (
    <Box
      title="Earnings"
      eyebrow="JOB, FLOOR AND SLASH"
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
      <Boundary query={q} title="Earnings series" skeleton={<Skeleton height={260} />}>
        {(d) => <SeriesChart buckets={d.buckets} />}
      </Boundary>
    </Box>
  );
}

function Epochs() {
  const epochs = useEpochs();
  const claims = useClaims();
  return (
    <Box title="Epochs and claims" eyebrow="HOURLY MERKLE ROOTS">
      <Boundary query={epochs} title="Epochs" skeleton={<Skeleton height={96} />}>
        {(p) =>
          p.items.length === 0 ? (
            <EmptyState icon="epoch" title="No epoch posted yet">
              The first root is posted after the first hour of verified work.
            </EmptyState>
          ) : (
            <RowTable
              caption="Epochs"
              template="0.7fr 1.2fr 1.1fr 1.2fr 1fr"
              rows={p.items}
              rowKey={(e) => String(e.epoch)}
              cols={[
                { key: 'e', header: 'Epoch', render: (e) => `#${e.epoch}` },
                { key: 'r', header: 'Root', render: (e) => <code>{shortHash(e.root)}</code> },
                { key: 'p', header: 'Posted', render: (e) => (e.postedAt ? fmtTime(e.postedAt) : e.status) },
                {
                  key: 'tx',
                  header: 'Transaction',
                  render: (e) =>
                    e.txHash ? (
                      <a href={explorerTx(e.txHash)} target="_blank" rel="noreferrer noopener">
                        {shortHash(e.txHash)}
                      </a>
                    ) : (
                      'none'
                    ),
                },
                {
                  key: 't',
                  header: 'Proof',
                  render: (e) => (
                    <a
                      href={`${env.apiUrl}/v1/epochs/${e.epoch}/tree`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Merkle tree
                    </a>
                  ),
                },
              ]}
            />
          )
        }
      </Boundary>
      <h3 className="sd-sub-h">Your claims</h3>
      <Boundary query={claims} title="Claims" skeleton={<Skeleton height={80} />}>
        {(p) =>
          p.items.length === 0 ? (
            <EmptyState icon="claim" title="No claims yet">
              Claim your first payout from the Payments tab.
            </EmptyState>
          ) : (
            <RowTable
              caption="Claims"
              template="0.7fr 1fr 1fr 1.2fr 1.2fr"
              rows={p.items}
              rowKey={(r) => r.id}
              cols={[
                { key: 'epoch', header: 'Epoch', render: (r) => `#${r.epoch}` },
                { key: 'amt', header: 'Amount', render: (r) => <Money micros={r.amountMicros} /> },
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
              ]}
            />
          )
        }
      </Boundary>
    </Box>
  );
}

function Ledger() {
  const q = useLedger();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  // ledger ids are composite (ts|node|kind|job); two job-less rows can share one, so suffix repeats
  const keyed = useMemo(() => {
    const seen = new Map<string, number>();
    const m = new Map<(typeof rows)[number], string>();
    for (const r of rows) {
      const n = seen.get(r.id) ?? 0;
      seen.set(r.id, n + 1);
      m.set(r, n === 0 ? r.id : `${r.id}#${n}`);
    }
    return m;
  }, [rows]);
  let body: ReactNode;
  if (q.isPending) body = <Skeleton height={200} />;
  else if (q.isError)
    body = (
      <ErrorState title="Ledger unavailable" message={q.error.message} onRetry={() => void q.refetch()} />
    );
  else if (rows.length === 0)
    body = (
      <EmptyState icon="ledger" title="No ledger entries">
        Earnings appear after your first verified job.
      </EmptyState>
    );
  else {
    body = (
      <>
        <RowTable
          caption="Earnings ledger"
          template="1.2fr 1fr 1fr 0.8fr 1fr"
          rows={rows}
          rowKey={(r) => keyed.get(r) ?? r.id}
          cols={[
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
          ]}
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
    <Box
      title="Ledger"
      eyebrow="EVERY EARNING EVENT"
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
    </Box>
  );
}

export default function AccountsTab() {
  return (
    <div className="sd-overview">
      <PageHead eyebrow="THE LEDGER" line1="Every unit." line2="Accounted for.">
        Job, floor and slash earnings, posted <br />
        in hourly Merkle roots you can verify.
      </PageHead>
      <Series />
      <Epochs />
      <Ledger />
    </div>
  );
}
