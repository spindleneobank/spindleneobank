import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { PageHead } from '../shell/ui';
import './compute.css';
import { isPairCode, normalizePairCode } from './format';
import { InstallPanel } from './Install';
import { NodeDialog } from './NodeDialog';
import { NodeTable } from './NodeTable';
import { PairBox, PairDialog } from './Pair';
import { useNodes } from './queries';

/** `?pair=ABCD-EFGH` (from the node's printed link) opens the approve dialog once. */
function initialPairCode(): string | null {
  if (typeof window === 'undefined') return null;
  const c = normalizePairCode(new URLSearchParams(window.location.search).get('pair') ?? '');
  return isPairCode(c) ? c : null;
}

function clearPairParam() {
  const u = new URL(window.location.href);
  if (!u.searchParams.has('pair')) return;
  u.searchParams.delete('pair');
  window.history.replaceState(window.history.state, '', u);
}

export default function ComputeTab() {
  const nodes = useNodes();
  const [pairCode, setPairCode] = useState<string | null>(initialPairCode);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = nodes.data ?? [];
  const unregistered = list.filter((n) => !n.registered && !n.isHouse);
  const openName = list.find((n) => n.id === openId)?.name;

  return (
    <div className="sd-overview cp-tab">
      <PageHead eyebrow="COMPUTE SUPPLY" line1="Your machines." line2="A bonded identity.">
        Install the node, approve it, register it on-chain. <br />
        Staking is optional and lifts it to the priority tier.
      </PageHead>

      {unregistered.length > 0 ? (
        <div className="cp-banner cp-banner-top" role="alert">
          <strong>
            {unregistered.length === 1
              ? `${unregistered[0]?.name} is not registered.`
              : `${unregistered.length} nodes are not registered.`}
          </strong>
          <span>
            This node receives no jobs and earns nothing until it is registered. Open it and register from
            your wallet.
          </span>
          <button
            type="button"
            className="cp-link-btn"
            onClick={() => setOpenId(unregistered[0]?.id ?? null)}
          >
            Register now
          </button>
        </div>
      ) : null}

      <div className="cp-top">
        <InstallPanel />
        <PairBox onPaired={(id) => setOpenId(id)} />
      </div>

      <section className="sd-box sd-flat" aria-labelledby="cp-nodes-h">
        <div className="sd-box-top">
          <div>
            <span className="sd-eyebrow">STEP 3</span>
            <h2 id="cp-nodes-h">Your nodes</h2>
          </div>
          <small className="cp-sub">Updates every 10 seconds</small>
        </div>
        {nodes.isPending ? <Skeleton height={220} /> : null}
        {nodes.isError ? (
          <ErrorState
            title="Nodes unavailable"
            message={nodes.error.message}
            onRetry={() => void nodes.refetch()}
          />
        ) : null}
        {nodes.data && list.length === 0 ? (
          <EmptyState icon="nodes" title="Your first node starts here">
            Generate an install command above and run it on your GPU machine. It will show up here within a
            few seconds.
          </EmptyState>
        ) : null}
        {list.length > 0 ? <NodeTable nodes={list} onOpen={setOpenId} /> : null}
        <p className="cp-note" role="note">
          Staking SPDL is optional. Staked nodes (at or above their class minimum) are the priority tier;
          registered nodes without stake serve jobs when no staked node is free. The share and claim timing
          are the same.
        </p>
      </section>

      <PairDialog
        code={pairCode}
        onClose={() => {
          setPairCode(null);
          clearPairParam();
        }}
        onPaired={(id) => setOpenId(id)}
      />
      <NodeDialog id={openId} name={openName} onClose={() => setOpenId(null)} />
    </div>
  );
}
