import type { ReactNode } from 'react';

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="sp-stat">
      <span className="sp-stat-label">{label}</span>
      <strong className="sp-stat-value">{value}</strong>
      {note ? <small className="sp-stat-note">{note}</small> : null}
    </div>
  );
}
