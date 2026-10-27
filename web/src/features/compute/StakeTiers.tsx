import type { NodeView } from '@spindle/shared/api';
import { Skeleton } from '../../components/Skeleton';
import { CLASS_LABEL, fmtSpdl } from './format';
import { useStakingParams } from './queries';

const CLASSES = [0, 1, 2, 3, 4] as const;

/** Share of the class minimum covered by active stake, 0..100. */
function pct(active: bigint, min: bigint): number {
  if (min <= 0n) return 0;
  if (active >= min) return 100;
  return Number((active * 100n) / min);
}

/** One registered node's way to the priority tier of its own class. */
function NodeProgress({ node, min }: { node: NodeView; min: bigint }) {
  const active = BigInt(node.stake.active);
  const p = pct(active, min);
  const done = active >= min;
  return (
    <li className="cp-tier-node">
      <div className="cp-tier-node-top">
        <span className="cp-tier-node-name">{node.name}</span>
        <span className="cp-tier-node-amt">
          {fmtSpdl(active)} / {fmtSpdl(min)} SPDL
        </span>
      </div>
      <div
        className="cp-tier-bar"
        role="progressbar"
        aria-label={`${node.name} stake toward the priority tier`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p}
      >
        <span data-done={done || undefined} style={{ width: `${p}%` }} />
      </div>
      <small className="cp-sub" data-tier={done ? 'staked' : undefined}>
        {done ? 'Priority tier' : `${fmtSpdl(min - active)} SPDL more for the priority tier`}
      </small>
    </li>
  );
}

/**
 * Stake tiers: the per-class priority minimum, read live from the staking contract, plus each of the
 * user's registered nodes and how far its active stake is from its class minimum. The class follows the
 * node's hardware; stake only decides priority inside it.
 */
export function StakeTiers({ nodes }: { nodes: NodeView[] }) {
  const params = useStakingParams();
  if (params.isPending) return <Skeleton height={180} />;
  if (params.isError || !params.data) {
    return (
      <p className="cp-note" role="note">
        Stake tiers are unavailable right now.
      </p>
    );
  }
  const mins = params.data.minStakeByClass;
  const mine = nodes.filter((n) => n.registered && !n.isHouse);
  const days = Math.round(params.data.unstakeDelay / 86_400);

  return (
    <div className="cp-tiers">
      <div className="cp-tiers-head">
        <h3 id="cp-tiers-h">Stake tiers</h3>
        <small className="cp-sub">
          Minimums are read from the staking contract. Unstaking takes {days} {days === 1 ? 'day' : 'days'}.
        </small>
      </div>
      <table className="cp-tier-table" aria-labelledby="cp-tiers-h">
        <thead>
          <tr>
            <th scope="col">GPU class</th>
            <th scope="col">Priority minimum</th>
            <th scope="col">Your registered nodes</th>
          </tr>
        </thead>
        <tbody>
          {CLASSES.map((c) => {
            const raw = mins[String(c)];
            const inClass = mine.filter((n) => n.gpuClass === c);
            return (
              <tr key={c} data-mine={inClass.length > 0 || undefined}>
                <th scope="row">{CLASS_LABEL[c]}</th>
                <td>{raw == null ? '—' : `${fmtSpdl(raw)} SPDL`}</td>
                <td>
                  {inClass.length === 0 || raw == null ? (
                    <span className="cp-sub">—</span>
                  ) : (
                    <ul className="cp-tier-nodes">
                      {inClass.map((n) => (
                        <NodeProgress key={n.id} node={n} min={BigInt(raw)} />
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="cp-note" role="note">
        A node's class comes from its detected hardware; staking cannot move it to another class. At or above
        its class minimum a node is in the priority tier and is picked first. Below it, or unstaked, it still
        serves jobs whenever no priority node is free, at the same share and claim timing.
      </p>
    </div>
  );
}
