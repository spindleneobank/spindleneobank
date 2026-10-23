import { useEffect, useState } from 'react';
import { CTA } from '../../components/CTA';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { type Column, Table } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { env } from '../../config';
import { useReceipt, useReceipts } from '../shell/queries';
import { fmtTime, Panel } from '../shell/ui';

type Lane = '' | 'sealed' | 'open';

function pill(status: string, verified: boolean | null) {
  if (status === 'failed' || status === 'timeout' || status === 'cancelled' || verified === false) {
    return <StatusPill tone="danger">Failed</StatusPill>;
  }
  if (verified === true) return <StatusPill tone="ok">Verified</StatusPill>;
  return <StatusPill tone="warn">Pending</StatusPill>;
}

function Detail({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const q = useReceipt(jobId);
  const { toast } = useToast();
  const r = q.data;
  const rows: [string, React.ReactNode][] = r
    ? [
        ['Job', <code key="j">{r.jobId}</code>],
        ['Lane', r.lane],
        ['Node', <code key="n">{r.nodeKey}</code>],
        ['Model', r.model],
        ['Units', `${r.usage.p} prompt + ${r.usage.c} completion tokens`],
        ['Provider share', r.earning ? <Money key="m" micros={r.earning.providerMicros} /> : 'none'],
        ['Verification', r.verified ? 'Verified' : r.reason ? `Failed: ${r.reason}` : 'Pending'],
        ['Epoch', r.epoch === null ? 'not in a root yet' : `#${r.epoch}`],
        ...(r.lane === 'sealed'
          ? ([['Attestation ref', r.attestationRef ?? 'none']] as [string, string][])
          : []),
      ]
    : [];
  return (
    <Dialog open={!!jobId} onClose={onClose} title="Receipt">
      {q.isPending && jobId ? <Skeleton height={200} /> : null}
      {q.isError ? (
        <ErrorState title="Receipt unavailable" message={q.error.message} onRetry={() => void q.refetch()} />
      ) : null}
      {r ? (
        <>
          <dl className="sd-kv sd-kv-col">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div>
              <dt>COSE (base64)</dt>
              <dd>
                <code className="sd-cose">{r.cose}</code>
              </dd>
            </div>
          </dl>
          <div className="sd-actions-row">
            <CTA
              icon="copy"
              onClick={() =>
                void navigator.clipboard
                  .writeText(r.cose)
                  .then(() => toast('COSE copied', 'ok'))
                  .catch(() => toast('Copy failed', 'error'))
              }
            >
              Copy COSE
            </CTA>
            <CTA href={`${env.apiUrl}/v1/receipts/${r.jobId}`} variant="secondary" icon="external">
              Public receipt
            </CTA>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

export default function ActivityTab() {
  const [lane, setLane] = useState<Lane>('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const list = useReceipts(lane, q);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'ts', header: 'Time', render: (r) => fmtTime(r.createdAt) },
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <button type="button" className="sd-link" onClick={() => setOpen(r.jobId)}>
          {r.model}
        </button>
      ),
    },
    { key: 'lane', header: 'Lane', render: (r) => r.lane },
    { key: 'node', header: 'Node', render: (r) => r.nodeName },
    { key: 'st', header: 'Status', render: (r) => pill(r.status, r.verified) },
    {
      key: 'm',
      header: 'Provider share',
      align: 'right',
      render: (r) => <Money micros={r.providerMicros} />,
    },
  ];
  return (
    <div className="sd-overview">
      <h1>Activity</h1>
      <Panel title="Receipts" eyebrow="Signed at the source">
        <div className="sd-filters">
          <label className="sd-search">
            <span className="sp-sr-only">Search receipts</span>
            <input
              type="search"
              placeholder="Search model, node or job id"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="sd-seg" role="group" aria-label="Lane">
            {(
              [
                ['', 'All'],
                ['sealed', 'Sealed'],
                ['open', 'Open'],
              ] as const
            ).map(([v, label]) => (
              <button key={label} type="button" aria-pressed={lane === v} onClick={() => setLane(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.isPending ? <Skeleton height={260} /> : null}
        {list.isError ? (
          <ErrorState
            title="Activity unavailable"
            message={list.error.message}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        {list.data ? (
          <>
            <Table
              caption="Receipts"
              columns={cols}
              rows={rows}
              rowKey={(r) => r.jobId}
              empty={
                <EmptyState
                  icon="receipt"
                  title={q || lane ? 'No receipts match' : 'Every job leaves a trace'}
                >
                  {q || lane ? 'Try a different search or lane.' : 'Your verified activity will appear here.'}
                </EmptyState>
              }
            />
            {list.hasNextPage ? (
              <CTA
                variant="secondary"
                icon=""
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? 'Loading' : 'Load more'}
              </CTA>
            ) : null}
          </>
        ) : null}
      </Panel>
      <Detail jobId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
