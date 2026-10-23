import type { NodeView } from '@spindle/shared/api';
import { useState } from 'react';
import { CTA } from '../../components/CTA';
import { Money } from '../../components/Money';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { fmtTime, RowTable } from '../shell/ui';
import { CLASS_LABEL, fmtSpdl, readCanary, readProbe, stakeState, statusTone } from './format';
import { useRename } from './queries';

function RenameName({ node }: { node: NodeView }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(node.name);
  const rename = useRename();
  const { toast } = useToast();
  const save = () => {
    const name = val.trim();
    if (!name || name === node.name) {
      setEditing(false);
      setVal(node.name);
      return;
    }
    rename.mutate(
      { id: node.id, name },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => toast(`Could not rename: ${e.message}`, 'error'),
      },
    );
  };
  if (!editing) {
    return (
      <span className="cp-name">
        <strong>{node.name}</strong>
        {node.isHouse ? <span className="cp-badge">House</span> : null}
        <button
          type="button"
          className="cp-link-btn"
          aria-label={`Rename ${node.name}`}
          onClick={() => {
            setVal(node.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
      </span>
    );
  }
  return (
    <form
      className="cp-rename"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        aria-label="Node name"
        maxLength={64}
        // biome-ignore lint/a11y/noAutofocus: focus moves to the field the user just opened
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <button type="submit" className="cp-link-btn" disabled={rename.isPending}>
        {rename.isPending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="cp-link-btn" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}

function Checks({ node }: { node: NodeView }) {
  const p = readProbe(node.lastProbe);
  const c = readCanary(node.lastCanary);
  if (!p && !c) return <span className="cp-sub">none yet</span>;
  return (
    <span className="cp-checks">
      {p ? (
        <span data-ok={p.ok}>
          Probe {p.ok ? 'pass' : 'fail'}
          {p.note ? ` · ${p.note}` : ''}
        </span>
      ) : null}
      {c ? <span data-ok={c.ok}>Canary {c.ok ? 'pass' : 'fail'}</span> : null}
    </span>
  );
}

function StakeCell({ node }: { node: NodeView }) {
  const s = stakeState(node);
  if (s === 'unregistered') return <span className="cp-sub">Register first</span>;
  const pend = BigInt(node.stake.pending);
  return (
    <span className="cp-stack">
      <span>
        {fmtSpdl(node.stake.active)} / {fmtSpdl(node.stake.min)} SPDL
      </span>
      <span className="cp-sub" data-tier={s}>
        {s === 'staked' ? 'Priority tier' : s === 'below-min' ? 'Below minimum' : 'Not staked'}
        {pend > 0n ? ` · ${fmtSpdl(pend)} unlocking` : ''}
      </span>
    </span>
  );
}

export function NodeTable({ nodes, onOpen }: { nodes: NodeView[]; onOpen: (id: string) => void }) {
  return (
    <RowTable
      className="cp-rt"
      caption="Your nodes"
      template="1.5fr 1fr 1.6fr 0.7fr 1.3fr 0.5fr 1.2fr 0.8fr auto"
      rows={nodes}
      rowKey={(n) => n.id}
      cols={[
        {
          key: 'name',
          header: 'Node',
          render: (n) => (
            <span className="cp-stack">
              <RenameName node={n} />
              <span className="cp-sub">
                {n.engine} · {n.lane} lane
              </span>
            </span>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (n) => (
            <span className="cp-stack">
              <StatusPill tone={statusTone(n.status)}>{n.status}</StatusPill>
              <span className="cp-sub">{n.lastSeenAt ? `seen ${fmtTime(n.lastSeenAt)}` : 'never seen'}</span>
            </span>
          ),
        },
        {
          key: 'hw',
          header: 'Hardware',
          render: (n) => (
            <span className="cp-stack">
              <span>
                {n.gpuModel
                  ? `${n.gpuModel.replace(/^NVIDIA (GeForce )?/, '')} × ${n.gpuCount ?? 1}`
                  : 'CPU only'}
                {n.vramGb ? ` · ${n.vramGb} GB` : ''}
              </span>
              <span className="cp-sub">{CLASS_LABEL[n.gpuClass]}</span>
            </span>
          ),
        },
        {
          key: 'reg',
          header: 'Registered',
          render: (n) =>
            n.registered ? (
              <span className="cp-reg" data-on="true">
                ✓ Yes
              </span>
            ) : (
              <span className="cp-reg" data-on="false">
                – Not yet
              </span>
            ),
        },
        { key: 'stake', header: 'Stake', render: (n) => <StakeCell node={n} /> },
        { key: 'rep', header: 'Rep', render: (n) => n.reputation },
        { key: 'checks', header: 'Last checks', render: (n) => <Checks node={n} /> },
        {
          key: 'earn',
          header: '24h earned',
          align: 'right',
          render: (n) => <Money micros={n.earnings24hMicros} />,
        },
        {
          key: 'open',
          header: '',
          render: (n) => (
            <CTA
              variant={n.registered ? 'ghost' : 'primary'}
              icon={n.registered ? 'arrow' : 'registry'}
              aria-label={`${n.registered ? 'Open' : 'Register'} ${n.name}`}
              onClick={() => onOpen(n.id)}
            >
              {n.registered ? 'Manage' : 'Register'}
            </CTA>
          ),
        },
      ]}
    />
  );
}
