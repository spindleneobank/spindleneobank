import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';

export type TabItem = { id: string; label: string; content: ReactNode };

export function Tabs({ items, initial, label }: { items: TabItem[]; initial?: string; label: string }) {
  const [active, setActive] = useState(initial ?? items[0]?.id);
  const base = useId();
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    if (next) {
      setActive(next.id);
      document.getElementById(`${base}-t-${next.id}`)?.focus();
    }
  };
  return (
    <div className="sp-tabs">
      <div role="tablist" aria-label={label} className="sp-tablist">
        {items.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-t-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-p-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-p-${t.id}`}
          aria-labelledby={`${base}-t-${t.id}`}
          hidden={active !== t.id}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
