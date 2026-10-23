import { useId, useState } from 'react';

export type FAQItem = { q: string; a: string };

/** Arcade FAQ: single-open accordion, keyboard accessible, content in the DOM for prerender. */
export function FAQ({ items }: { items: FAQItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <div className="sp-faq" id="faq">
      {items.map((item, i) => {
        const expanded = open === i;
        return (
          <div key={item.q} className="sp-faq-item" data-open={expanded}>
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`${base}-${i}`}
                onClick={() => setOpen(expanded ? null : i)}
              >
                <span className="sp-faq-num">{String(i + 1).padStart(2, '0')}</span>
                {item.q}
              </button>
            </h3>
            <div id={`${base}-${i}`} role="region" hidden={!expanded}>
              <p>{item.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
