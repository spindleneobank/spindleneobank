import type { ReactNode } from 'react';
import { Eyebrow } from './Eyebrow';

export function Section({
  id,
  eyebrow,
  title,
  lead,
  tone = 'paper',
  children,
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  tone?: 'paper' | 'night';
  children?: ReactNode;
}) {
  return (
    <section id={id} className={`sp-section sp-section-${tone}`}>
      <div className="sp-container">
        {(eyebrow || title || lead) && (
          <header className="sp-section-head">
            {eyebrow ? <Eyebrow tone={tone === 'paper' ? 'dark' : 'light'}>{eyebrow}</Eyebrow> : null}
            {title ? <h2>{title}</h2> : null}
            {lead ? <p className="sp-lead">{lead}</p> : null}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
