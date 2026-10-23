import { PixelIcon } from '../PixelIcon';
import { Callout } from './blocks';

export type Lane = {
  id: string;
  badge: string;
  eyebrow: string;
  title: string;
  body: string;
  icon: string;
  stat: string;
  statLabel: string;
  details: string[];
  warning: string;
};

/** One of the three reference columns: name, big stat, details list. */
export function LaneCard({ lane }: { lane: Lane }) {
  return (
    <article className="spm-lane" id={lane.id} data-lane={lane.id}>
      <header>
        <h2>{lane.eyebrow}</h2>
        <span className="spm-badge" data-lane={lane.id}>
          {lane.badge}
        </span>
      </header>
      <p className="spm-lane-sub">{lane.title}</p>
      <div className="spm-lane-stat">
        <strong>{lane.stat}</strong>
        <span>{lane.statLabel}</span>
      </div>
      <p>{lane.body}</p>
      <hr />
      <h3>Design details</h3>
      <ul className="spm-bullets">
        {lane.details.map((d) => (
          <li key={d}>
            <PixelIcon name="check" size={14} />
            {d}
          </li>
        ))}
      </ul>
      <Callout tone="warn">{lane.warning}</Callout>
    </article>
  );
}

export function SharedColumn({
  eyebrow,
  stat,
  statLabel,
  badge,
  items,
  footer,
}: {
  eyebrow: string;
  stat: string;
  statLabel: string;
  badge: string;
  items: string[];
  footer: string;
}) {
  return (
    <article className="spm-lane" id="shared" data-lane="shared">
      <header>
        <h2>{eyebrow}</h2>
        <span className="spm-badge">{badge}</span>
      </header>
      <p className="spm-lane-sub">Evidence across both lanes</p>
      <div className="spm-lane-stat">
        <strong>{stat}</strong>
        <span>{statLabel}</span>
      </div>
      <p>{footer}</p>
      <hr />
      <h3>Design details</h3>
      <ul className="spm-bullets">
        {items.map((d) => (
          <li key={d}>
            <PixelIcon name="check" size={14} />
            {d}
          </li>
        ))}
      </ul>
    </article>
  );
}
