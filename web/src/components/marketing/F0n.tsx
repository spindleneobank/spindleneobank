import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { CTA } from '../CTA';
import { Eyebrow } from '../Eyebrow';
import './f0n.css';

const SITE = 'Spindle';

/** Standard head() output for a marketing page. */
export function pageHead(
  title: string,
  description: string,
  path: string,
  opts?: { noindex?: boolean; refreshTo?: string },
) {
  const meta: Record<string, string>[] = [
    { title: `${title} | ${SITE}` },
    { name: 'description', content: description },
    { property: 'og:title', content: `${title} | ${SITE}` },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
  if (opts?.noindex) meta.push({ name: 'robots', content: 'noindex' });
  if (opts?.refreshTo) meta.push({ httpEquiv: 'refresh', content: `0; url=${opts.refreshTo}` });
  return { meta, links: [{ rel: 'canonical', href: opts?.refreshTo ?? path }] };
}

export function PageHero({
  eyebrow,
  title,
  lead,
  media,
  center,
  wide,
  back,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  media?: string;
  center?: boolean;
  wide?: boolean;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <section className={`f0n-hero${center ? ' is-center' : ''}${wide ? ' is-wide' : ''}`}>
      {media ? (
        <div className="f0n-hero-media" style={{ backgroundImage: `url(${media})` }} aria-hidden="true" />
      ) : null}
      <div className="sp-container">
        {back ? (
          <Link to={back.to} className="f0n-back">
            ← {back.label}
          </Link>
        ) : null}
        {eyebrow ? <Eyebrow tone="light">{eyebrow}</Eyebrow> : null}
        <h1>{title}</h1>
        {lead ? <p className="f0n-lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function CtaBand() {
  return (
    <section className="f0n-cta">
      <div className="sp-container">
        <h2>Your compute. Your payout.</h2>
        <div>
          <p>
            Explore how Spindle connects GPU supply, verifiable AI work and USDG payouts on Robinhood Chain.
          </p>
          <div className="f0n-actions">
            <CTA to="/dashboard/overview" variant="primary">
              Open dashboard
            </CTA>
            <CTA to="/compute-lanes" variant="secondary" icon="">
              Explore lanes
            </CTA>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Prerendered fallback for moved slugs on static preview servers (vercel.json issues the real 301). */
export function MovedNotice({ to }: { to: string }) {
  return (
    <PageHero
      eyebrow="Moved"
      title="This page has moved"
      lead={
        <>
          Continue at <a href={to}>{to}</a>.
        </>
      }
    />
  );
}

/** Hidden links so the prerender crawler discovers the moved-slug fallback pages. */
export function LegacyLinks({ paths }: { paths: string[] }) {
  return (
    <ul hidden aria-hidden="true">
      {paths.map((p) => (
        <li key={p}>
          <a href={p} tabIndex={-1}>
            {p}
          </a>
        </li>
      ))}
    </ul>
  );
}
