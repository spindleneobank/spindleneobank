import type { UseQueryResult } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import './dash.css';

/** Loading skeleton / error with retry / children(data). Empty handling stays with the caller. */
export function Boundary<T>({
  query,
  skeleton,
  title,
  children,
}: {
  query: Pick<UseQueryResult<T>, 'data' | 'isPending' | 'isError' | 'error' | 'refetch'>;
  skeleton?: ReactNode;
  title: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <Skeleton height={96} />}</>;
  if (query.isError || query.data === undefined) {
    return (
      <ErrorState
        title={`${title} unavailable`}
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <>{children(query.data)}</>;
}

export function Panel({
  title,
  eyebrow,
  action,
  className = '',
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`sd-panel sd-card ${className}`}>
      <header className="sd-card-head">
        <div>
          {eyebrow ? <small>{eyebrow}</small> : null}
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "37m 12s" / "2h 05m"; null when the target is in the past. */
export function countdown(targetIso: string | null, now: number): string | null {
  if (!targetIso) return null;
  const s = Math.floor((Date.parse(targetIso) - now) / 1000);
  if (s <= 0) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Page hero: eyebrow, two-line headline (second line muted) and right-aligned subcopy. */
export function PageHead({
  eyebrow,
  line1,
  line2,
  children,
}: {
  eyebrow: string;
  line1: string;
  line2: string;
  children?: ReactNode;
}) {
  return (
    <div className="sd-hero">
      <div>
        <span className="sd-eyebrow">{eyebrow}</span>
        <h1>
          {line1}
          <br />
          <em>{line2}</em>
        </h1>
      </div>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export type RowCol<T> = {
  key: string;
  header: string;
  align?: 'right';
  render: (row: T) => ReactNode;
};

/** Grid "table" that collapses to labelled cards on phones (no clipped columns, no horizontal scroll). */
export function RowTable<T>({
  caption,
  cols,
  rows,
  rowKey,
  template,
  onRow,
  className = '',
}: {
  className?: string;
  caption: string;
  cols: RowCol<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  template: string;
  onRow?: (r: T) => void;
}) {
  return (
    <div className={`sd-rt ${className}`} style={{ '--cols': template } as React.CSSProperties}>
      <div className="sd-rt-head" aria-hidden="true">
        {cols.map((c) => (
          <span key={c.key} data-align={c.align}>
            {c.header}
          </span>
        ))}
      </div>
      <ul className="sd-rt-body" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="sd-rt-row">
            {onRow ? (
              <button
                type="button"
                className="sd-rt-hit"
                aria-label={`Open ${rowKey(r)}`}
                onClick={() => onRow(r)}
              />
            ) : null}
            {cols.map((c) => (
              <span key={c.key} data-label={c.header} data-align={c.align}>
                {c.render(r)}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
