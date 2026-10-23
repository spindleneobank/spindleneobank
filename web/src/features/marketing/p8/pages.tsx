import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ButtonPrimary, ButtonSecondary } from '../../../components/marketing/shell';
import { ARCH_COMPONENTS, type ArchComponent, LEGAL_DOCS } from './data';
import { Band, Lines, Pill } from './parts';

export function ArchitectureIndex() {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term
    ? ARCH_COMPONENTS.filter((c) => `${c.title} ${c.indexLead}`.toLowerCase().includes(term))
    : ARCH_COMPONENTS;
  return (
    <section className="p8 p8-index">
      <div className="p8-title">
        <div className="p8-container">
          <div className="p8-stack">
            <Pill>Architecture</Pill>
            <h1 className="p8-h1">Explore the compute architecture</h1>
            <p className="p8-lead">
              The components behind node registration, AI requests, signed receipts and payout routing.
              Specification preview.
            </p>
          </div>
        </div>
      </div>
      <Band className="p8-search">
        <Lines sides={['t', 'b']} />
        <div className="p8-row">
          <h2 className="p8-h2">All components</h2>
          <label className="p8-field">
            <div className="p8-field-box">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                name="search"
                placeholder="Search"
                aria-label="Search components"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </label>
        </div>
      </Band>
      <Band className="p8-grid-wrap">
        <Lines sides={['b']} />
        <div className="p8-grid-in">
          <div className="p8-grid">
            {shown.map((c) => (
              <Link key={c.slug} to="/architecture/$slug" params={{ slug: c.slug }} className="p8-card">
                <div className="p8-card-in">
                  <Lines sides={['b', 'r']} />
                  <div className="p8-card-logo">
                    <img src={`/assets/pixel/${c.icon}.svg`} alt="" width={38} height={38} />
                  </div>
                  <div className="p8-card-text">
                    <p className="p8-card-title">{c.title}</p>
                    <p className="p8-card-desc">{c.indexLead}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </Band>
    </section>
  );
}

export function ArchitectureDetail({ c }: { c: ArchComponent }) {
  const fact = (h: string, v: string) => (
    <div className="p8-fact">
      <p className="p8-fact-h">{h}</p>
      <p className="p8-lead">{v}</p>
    </div>
  );
  return (
    <section className="p8">
      <div className="p8-title p8-title-detail">
        <div className="p8-container" style={{ gap: 32 }}>
          <Link to="/architecture" className="p8-back">
            <i />
            <p>All components</p>
          </Link>
          <div className="p8-stack p8-stack-detail">
            <div className="p8-icon">
              <img src={`/assets/pixel/${c.icon}.svg`} alt="" width={58} height={58} />
            </div>
            <h1 className="p8-h1">{c.title}</h1>
            <p className="p8-lead">{c.lead}</p>
          </div>
        </div>
      </div>
      <Band className="p8-detail-body">
        <Lines sides={['t', 'b']} />
        <div className="p8-detail-row">
          <div className="p8-prose">
            <div className="p8-prose-in">
              <h6 className="p8-h6">Data flow</h6>
              <p className="p8-lead">{c.dataFlow}</p>
              <h6 className="p8-h6">Design boundary</h6>
              <p className="p8-lead">{c.boundary}</p>
              <h6 className="p8-h6">How it fits</h6>
              <p className="p8-lead">{c.fits}</p>
              <h6 className="p8-h6">Lifecycle</h6>
              <p className="p8-lead">{c.lifecycle}</p>
            </div>
          </div>
          <div className="p8-aside">
            <Lines sides={['l']} />
            {fact('Category', c.category)}
            {fact('Records', c.records)}
            {fact('Flow', c.flow)}
            <ButtonSecondary to="/dashboard">Explore dashboard</ButtonSecondary>
          </div>
        </div>
      </Band>
    </section>
  );
}

export function LegalBody({ slug }: { slug: string }) {
  const d = LEGAL_DOCS[slug];
  if (!d) return null;
  return (
    <section className="p8 p8-legal-page">
      <div className="p8-title">
        <div className="p8-container p8-container-c">
          <Pill>{d.pill}</Pill>
          <h1 className="p8-h1 p8-center">{d.title}</h1>
          <p className="p8-lead p8-center">{d.date}</p>
        </div>
      </div>
      <Band className="p8-legal">
        <Lines sides={['t', 'b']} />
        <div className="p8-legal-in">
          <div className="p8-legal-col">
            {d.sections.map((s) => (
              <div className="p8-legal-item" key={s.heading}>
                <h4 className="p8-h4">{s.heading}</h4>
                {s.html ? (
                  <p className="p8-lead" dangerouslySetInnerHTML={{ __html: s.html }} />
                ) : (
                  <p className="p8-lead">{s.body}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </Band>
    </section>
  );
}

export function NotFoundBody() {
  return (
    <section className="p8 p8-404">
      <Lines sides={['t', 'b']} />
      <div className="p8-404-box">
        <div className="p8-404-title">
          <Pill>404</Pill>
          <h1 className="p8-h1 p8-center">Page not found</h1>
          <p className="p8-lead p8-center p8-c">This route is outside the network. Let’s take you back.</p>
        </div>
        <ButtonPrimary to="/" lg>
          Back To Home
        </ButtonPrimary>
      </div>
    </section>
  );
}
