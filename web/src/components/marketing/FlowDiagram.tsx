import { PixelIcon } from '../PixelIcon';

/** Illustrative claim flow: linear nodes then a fork into card and stock. Static, no data. */
export function FlowDiagram({
  nodes,
  branches,
}: {
  nodes: { label: string; note: string }[];
  branches: { label: string; note: string }[];
}) {
  return (
    <div
      className="spm-flow"
      role="img"
      aria-label="Claim flow: receipt, verify, claim to wallet, then fund a card or swap to a Stock Token"
    >
      <div className="spm-flow-main">
        {nodes.map((n, i) => (
          <div key={n.label} className="spm-flow-node">
            <b>{String(i + 1).padStart(2, '0')}</b>
            <strong>{n.label}</strong>
            <small>{n.note}</small>
          </div>
        ))}
      </div>
      <div className="spm-flow-fork" aria-hidden="true">
        <PixelIcon name="arrow-down" size={18} />
      </div>
      <div className="spm-flow-branches">
        {branches.map((b) => (
          <div key={b.label} className="spm-flow-node spm-flow-branch">
            <strong>{b.label}</strong>
            <small>{b.note}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export type NetNode = { id: string; icon: string; label: string; note: string };

/** Product network diagram: gateway to wallet claim, with the optional card/stock step after. */
export function NetworkDiagram({
  nodes,
  after,
}: {
  nodes: NetNode[];
  after: { icon: string; label: string }[];
}) {
  return (
    <div className="spm-net" role="img" aria-label="Network diagram from API gateway to wallet claim">
      <div className="spm-net-row">
        {nodes.map((n, i) => (
          <div key={n.id} className="spm-net-cell">
            <div className="spm-net-node">
              <PixelIcon name={n.icon} size={26} />
              <strong>{n.label}</strong>
              <small>{n.note}</small>
            </div>
            {i < nodes.length - 1 ? <span className="spm-net-link" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
      <div className="spm-net-after">
        <span>then, optionally</span>
        {after.map((a) => (
          <div key={a.label} className="spm-net-node spm-net-small">
            <PixelIcon name={a.icon} size={20} />
            <strong>{a.label}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
