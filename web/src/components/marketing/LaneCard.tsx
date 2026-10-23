import { PixelIcon } from '../PixelIcon';
import { Callout } from './blocks';

export type Lane = {
  id: string;
  badge: string;
  eyebrow: string;
  title: string;
  body: string;
  icon: string;
  details: string[];
  warning: string;
};

export function LaneCard({ lane }: { lane: Lane }) {
  return (
    <article className="spm-lane" id={lane.id} data-lane={lane.id}>
      <header>
        <PixelIcon name={lane.icon} size={28} />
        <span className="spm-lane-eyebrow">{lane.eyebrow}</span>
        <span className="spm-badge" data-lane={lane.id}>
          {lane.badge}
        </span>
      </header>
      <h2>{lane.title}</h2>
      <p>{lane.body}</p>
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
