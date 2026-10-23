import type { NodeView } from '@spindle/shared/api';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { ErrorState } from '../../components/ErrorState';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { fmtTime } from '../shell/ui';
import { LinkIdentity, type Pending, RegisterSection, StakeSection, usePendingDone } from './Actions';
import { CLASS_LABEL, readCanary, readJob, readProbe, statusTone } from './format';
import { ck, useNode } from './queries';

function History({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { key: string; text: string; ok?: boolean }[];
}) {
  return (
    <div className="cp-hist">
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p className="cp-sub">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.key} data-ok={r.ok}>
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Body({ id }: { id: string }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [fast, setFast] = useState(false);
  const q = useNode(id, fast ? 3000 : 10_000);
  const node = q.data;
  const done = usePendingDone(node, pending);

  // Poll quickly while the indexer is catching up; refresh the list once it has.
  useEffect(() => {
    setFast(!!pending && !done);
    if (done) void qc.invalidateQueries({ queryKey: ck.nodes });
  }, [pending, done, qc]);
  useEffect(() => {
    if (!pending || done) return;
    const t = setTimeout(() => setFast(false), 180_000);
    return () => clearTimeout(t);
  }, [pending, done]);

  if (q.isPending) return <Skeleton height={260} />;
  if (q.isError || !node) {
    return (
      <ErrorState
        title="Node unavailable"
        message={q.error instanceof Error ? q.error.message : undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }
  return <Detail node={node} pending={pending} done={done} onSent={setPending} />;
}

function Detail({
  node,
  pending,
  done,
  onSent,
}: {
  node: NodeView;
  pending: Pending | null;
  done: boolean;
  onSent: (p: Pending) => void;
}) {
  const d = node as NodeView & { probes?: unknown[]; canaries?: unknown[]; jobs?: unknown[] };
  const probes = (d.probes ?? []).map(readProbe).filter((x) => x !== null);
  const canaries = (d.canaries ?? []).map(readCanary).filter((x) => x !== null);
  const jobs = (d.jobs ?? []).map(readJob).filter((x) => x !== null);
  return (
    <div className="cp-detail">
      <dl className="sd-kv">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusPill tone={statusTone(node.status)}>{node.status}</StatusPill>
          </dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{node.registered ? `Yes · node #${node.onchainId}` : 'Not yet'}</dd>
        </div>
        <div>
          <dt>GPU class (detected)</dt>
          <dd>{CLASS_LABEL[node.gpuClass]}</dd>
        </div>
        <div>
          <dt>Hardware</dt>
          <dd>
            {node.gpuModel ? `${node.gpuModel} × ${node.gpuCount ?? 1}` : 'CPU only'}
            {node.vramGb ? ` · ${node.vramGb} GB` : ''}
          </dd>
        </div>
        <div>
          <dt>Engine · lane</dt>
          <dd>
            {node.engine} · {node.lane}
            {node.ccCapable ? ' · CC capable' : ''}
          </dd>
        </div>
        <div>
          <dt>Reputation</dt>
          <dd>{node.reputation}</dd>
        </div>
        <div>
          <dt>24h earnings</dt>
          <dd>
            <Money micros={node.earnings24hMicros} />
          </dd>
        </div>
        <div>
          <dt>Node key</dt>
          <dd>
            <code className="sd-address">{node.nodeKey}</code>
          </dd>
        </div>
      </dl>

      {!node.registered ? (
        <RegisterSection node={node} pending={pending} done={done} onSent={onSent} />
      ) : (
        <>
          <StakeSection node={node} pending={pending} done={done} onSent={onSent} />
          <LinkIdentity node={node} />
        </>
      )}

      <div className="cp-hists">
        <History
          title="Recent probes"
          empty="No probes yet."
          rows={probes.map((p, i) => ({
            key: `p${i}`,
            ok: p.ok,
            text: `${p.at ? fmtTime(p.at) : ''} · ${p.ok ? 'pass' : 'fail'}${p.note ? ` · ${p.note}` : ''}`,
          }))}
        />
        <History
          title="Recent canaries"
          empty="No canaries yet."
          rows={canaries.map((c, i) => ({
            key: `c${i}`,
            ok: c.ok,
            text: `${c.at ? fmtTime(c.at) : ''} · ${c.ok ? 'pass' : 'fail'}${c.note ? ` · ${c.note}` : ''}`,
          }))}
        />
        <History
          title="Recent jobs"
          empty={node.registered ? 'No jobs yet.' : 'No jobs until the node is registered.'}
          rows={jobs.map((j) => ({
            key: j.id,
            text: `${j.at ? fmtTime(j.at) : ''} · ${j.model} · ${j.status}${j.units ? ` · ${j.units} units` : ''}`,
          }))}
        />
      </div>
    </div>
  );
}

export function NodeDialog({ id, name, onClose }: { id: string | null; name?: string; onClose: () => void }) {
  return (
    <Dialog open={id !== null} onClose={onClose} title={name ?? 'Node'}>
      <div className="cp-wide">{id ? <Body key={id} id={id} /> : null}</div>
    </Dialog>
  );
}
