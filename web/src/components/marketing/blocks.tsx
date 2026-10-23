import type { ReactNode } from 'react';
import { CTA } from '../CTA';
import { Eyebrow } from '../Eyebrow';
import { PixelIcon } from '../PixelIcon';
import { Section } from '../Section';
import './marketing.css';
import { Pill } from './Pill';
import { Reveal } from './Reveal';
import type { Cta, Feature, Step } from './types';

export function CtaRow({ ctas }: { ctas: Cta[] }) {
  return (
    <div className="spm-cta-row">
      {ctas.map((c) => (
        <CTA key={c.label} to={c.to} variant={c.variant ?? 'primary'}>
          {c.label}
        </CTA>
      ))}
    </div>
  );
}

/** Dark hero with eyebrow, headline, lead and CTAs; optional right-hand panel. */
export function PageHero({
  eyebrow,
  title,
  lead,
  ctas,
  aside,
  extra,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  ctas?: Cta[];
  aside?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className="spm-hero">
      <div className="sp-container spm-hero-grid" data-aside={aside ? 'yes' : 'no'}>
        <div className="spm-hero-copy">
          <Pill tone="dark">{eyebrow}</Pill>
          <h1>{title}</h1>
          <p className="spm-hero-lead">{lead}</p>
          {ctas ? <CtaRow ctas={ctas} /> : null}
          {extra}
        </div>
        {aside ? <div className="spm-hero-aside">{aside}</div> : null}
      </div>
    </section>
  );
}

export function FeatureGrid({ items }: { items: Feature[] }) {
  return (
    <ul className="spm-grid">
      {items.map((f, i) => (
        <li key={f.title}>
          <Reveal delay={i * 0.06} className="spm-card">
            <PixelIcon name={f.icon} size={28} />
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="spm-steps">
      {steps.map((s, i) => (
        <li key={s.title}>
          <Reveal delay={i * 0.06} className="spm-step">
            <span className="spm-step-num">{String(i + 1).padStart(2, '0')}</span>
            {s.icon ? <PixelIcon name={s.icon} size={24} /> : null}
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}

export function Callout({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div className="spm-callout" data-tone={tone} role="note">
      <PixelIcon name="info" size={18} />
      <div>{children}</div>
    </div>
  );
}

/** Text + image split, alternating sides. Image is decorative (poster still, lazy). */
export function SplitFeature({
  id,
  eyebrow,
  title,
  body,
  bullets,
  cta,
  image,
  alt,
  caption,
  flip,
  tone = 'night',
}: {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  cta: Cta;
  image: string;
  alt: string;
  caption?: string;
  flip?: boolean;
  tone?: 'paper' | 'night';
}) {
  return (
    <Section id={id} tone={tone}>
      <div className="spm-split" data-flip={flip ? 'yes' : 'no'}>
        <Reveal className="spm-split-copy">
          <Eyebrow tone={tone === 'paper' ? 'dark' : 'light'}>{eyebrow}</Eyebrow>
          <h2>{title}</h2>
          <p className="sp-lead">{body}</p>
          <ul className="spm-bullets">
            {bullets.map((b) => (
              <li key={b}>
                <PixelIcon name="check" size={14} />
                {b}
              </li>
            ))}
          </ul>
          <CtaRow ctas={[cta]} />
        </Reveal>
        <Reveal delay={0.1} className="spm-split-media">
          <img src={image} alt={alt} loading="lazy" decoding="async" width={900} height={700} />
          {caption ? (
            <p className="spm-media-cap">
              <PixelIcon name="check" size={12} />
              {caption}
            </p>
          ) : null}
        </Reveal>
      </div>
    </Section>
  );
}

export function ClosingCta({ title, body, ctas }: { title: string; body: string; ctas: Cta[] }) {
  return (
    <section className="spm-closing">
      <div className="sp-container spm-closing-grid">
        <h2>{title}</h2>
        <div>
          <p>{body}</p>
          <CtaRow ctas={ctas} />
        </div>
      </div>
    </section>
  );
}
