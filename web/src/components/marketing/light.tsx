import { useEffect, useState } from 'react';
import { DashboardPreview } from '../DashboardPreview';
import { PixelIcon } from '../PixelIcon';
import { CtaRow } from './blocks';
import { FlowDiagram } from './FlowDiagram';
import { Pill } from './Pill';
import './marketing.css';
import type { Cta } from './types';

/** Light gradient hero: pill, two-tone Chakra Petch headline, CTAs. */
export function LightHero({
  eyebrow,
  title,
  subtitle,
  lead,
  ctas,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  lead: string;
  ctas: Cta[];
}) {
  return (
    <section className="spm-lhero">
      <div className="spm-lhero-inner">
        <Pill>{eyebrow}</Pill>
        <h1>
          <span>{title}</span> <em>{subtitle}</em>
        </h1>
        <p>{lead}</p>
        <CtaRow ctas={ctas} />
      </div>
    </section>
  );
}

/** Striped gradient band with a framed illustrative image. */
export function MediaBand({ image, alt, bg }: { image: string; alt: string; bg?: string }) {
  return (
    <section
      className="spm-band"
      style={bg ? { backgroundImage: `url(${bg})` } : undefined}
      data-img={bg ? 'yes' : 'no'}
    >
      <div className="spm-band-frame">
        <img src={image} alt={alt} width={1920} height={1399} decoding="async" fetchPriority="low" />
      </div>
    </section>
  );
}

export function Marquee({ items }: { items: readonly string[] }) {
  const row = [...items, ...items];
  return (
    <div className="spm-marquee" aria-hidden="true">
      <div className="spm-marquee-track">
        {row.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static decorative list
          <span key={`${w}-${i}`}>{w}</span>
        ))}
      </div>
    </div>
  );
}

/** Framed illustration panel (card-in-card) used for the illustrative flows. */
export function IllusPanel({
  title,
  tag,
  children,
  dark,
}: {
  title: string;
  tag: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="spm-illus spm-br" data-dark={dark ? 'yes' : 'no'}>
      <div className="spm-illus-card">
        <header>
          <span>{title}</span>
          <small>{tag}</small>
        </header>
        <div className="spm-illus-body">{children}</div>
      </div>
    </div>
  );
}

const STACK_ICONS = [
  'receipts',
  'api',
  'nodes',
  'gateway',
  'scheduler',
  'merkle',
  'registry',
  'claim',
  'ledger',
];

export type PanelKind = 'receipt' | 'dashboard' | 'claim' | 'stack';

export function DemoPanel({
  kind,
  dark,
  receipt,
  claim,
}: {
  kind: PanelKind;
  dark?: boolean;
  receipt: { title: string; tag: string; question: string; answer: string; input: string };
  claim: { nodes: { label: string; note: string }[]; branches: { label: string; note: string }[] };
}) {
  if (kind === 'receipt')
    return (
      <IllusPanel title={receipt.title} tag={receipt.tag} dark={dark}>
        <div className="spm-chat">
          <p className="spm-chat-q">{receipt.question}</p>
          <div className="spm-chat-a">
            <PixelIcon name="receipts" size={16} />
            <span>Spindle</span>
            <p>{receipt.answer}</p>
          </div>
          <div className="spm-chat-in">{receipt.input}</div>
        </div>
      </IllusPanel>
    );
  if (kind === 'dashboard')
    return (
      <IllusPanel title="Network preview" tag="Spec preview" dark={dark}>
        <DashboardPreview />
      </IllusPanel>
    );
  if (kind === 'claim')
    return (
      <IllusPanel title="Claim flow" tag="Preview" dark={dark}>
        <FlowDiagram nodes={claim.nodes} branches={claim.branches} />
      </IllusPanel>
    );
  return (
    <IllusPanel title="Compute stack" tag="Preview" dark={dark}>
      <div className="spm-tiles" aria-hidden="true">
        {STACK_ICONS.map((n) => (
          <span key={n}>
            <PixelIcon name={n} size={26} />
          </span>
        ))}
      </div>
    </IllusPanel>
  );
}

export type FeatureTab = {
  id: string;
  label: string;
  icon: string;
  title: string;
  body: string;
  panel: PanelKind;
};

/** Left sticky list + right stacked illustrative panels (the reference's feature-tabs pattern). */
export function FeatureTabs({
  items,
  receipt,
  claim,
}: {
  items: readonly FeatureTab[];
  receipt: Parameters<typeof DemoPanel>[0]['receipt'];
  claim: Parameters<typeof DemoPanel>[0]['claim'];
}) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(`feat-${i.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id.replace('feat-', ''));
      },
      { rootMargin: '-35% 0px -55% 0px' },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [items]);
  return (
    <div className="spm-ftabs">
      <nav aria-label="Capabilities">
        <ul>
          {items.map((i) => (
            <li key={i.id} data-active={active === i.id}>
              <a href={`#feat-${i.id}`} onClick={() => setActive(i.id)}>
                {i.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="spm-ftabs-list">
        {items.map((i) => (
          <article key={i.id} id={`feat-${i.id}`}>
            <div className="spm-ftab-intro">
              <span className="spm-icon-tile">
                <PixelIcon name={i.icon} size={26} />
              </span>
              <p>
                <strong>{i.title}</strong> <span>{i.body}</span>
              </p>
            </div>
            <DemoPanel kind={i.panel} receipt={receipt} claim={claim} />
          </article>
        ))}
      </div>
    </div>
  );
}

const ORBIT = ['gpu', 'receipts', 'merkle', 'wallet', 'cards', 'stock', 'api', 'nodes'];

/** Circular network diagram: eight nodes around a hub. Decorative. */
export function OrbitDiagram({ label }: { label: string }) {
  return (
    <div className="spm-orbit" role="img" aria-label={label}>
      <span className="spm-orbit-ring" />
      <span className="spm-orbit-hub">
        <PixelIcon name="flower-pixel" size={28} />
      </span>
      {ORBIT.map((n, i) => {
        const a = (i / ORBIT.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <span
            key={n}
            className="spm-orbit-node"
            style={{ left: `${50 + 40 * Math.cos(a)}%`, top: `${50 + 40 * Math.sin(a)}%` }}
          >
            <PixelIcon name={n} size={16} />
          </span>
        );
      })}
    </div>
  );
}

export function HowColumns({
  steps,
  chips,
  payouts,
  dark,
}: {
  steps: { title: string; body: string }[];
  chips: string[];
  payouts: string[];
  dark?: boolean;
}) {
  return (
    <ol className="spm-how" data-dark={dark ? 'yes' : 'no'}>
      <li>
        <div className="spm-how-vis">
          <OrbitDiagram label="Circular diagram of the Spindle network: GPU, receipts, Merkle roots, wallet, card, stock, API, nodes" />
        </div>
        <h3>{steps[0]?.title}</h3>
        <p>{steps[0]?.body}</p>
      </li>
      <li>
        <div className="spm-how-vis">
          <div className="spm-chips-v">
            {chips.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
        <h3>{steps[1]?.title}</h3>
        <p>{steps[1]?.body}</p>
      </li>
      <li>
        <div className="spm-how-vis">
          <div className="spm-pay-v">
            {payouts.map((c) => (
              <span key={c}>
                <PixelIcon name="check" size={12} />
                {c}
              </span>
            ))}
          </div>
        </div>
        <h3>{steps[2]?.title}</h3>
        <p>{steps[2]?.body}</p>
      </li>
    </ol>
  );
}
