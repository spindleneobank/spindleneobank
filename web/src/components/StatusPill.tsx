export type PillTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export function StatusPill({ tone = 'neutral', children }: { tone?: PillTone; children: string }) {
  return (
    <span className={`sp-pill sp-pill-${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}
