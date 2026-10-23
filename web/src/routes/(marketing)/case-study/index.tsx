import { createFileRoute, Link } from '@tanstack/react-router';
import { CtaBand, LegacyLinks, PageHero, pageHead } from '../../../components/marketing/F0n';
import { FLOWS } from '../../../content/case-study';

export const Route = createFileRoute('/(marketing)/case-study/')({
  head: () =>
    pageHead(
      'Case studies',
      'Illustrative flows based on the Spindle design. They explain architecture and payout choices, not customer results.',
      '/case-study',
    ),
  component: CaseStudies,
});

function CaseStudies() {
  return (
    <>
      <PageHero
        eyebrow="Illustrative flows"
        title="A closer look at the intended network flows"
        wide
        lead="Illustrative flows based on the Spindle design. These explain the architecture and payout choices; they are not customer results or live deployments."
      />
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-head">
            <h2>All illustrative flows</h2>
          </div>
          <div className="f0n-grid-2">
            {FLOWS.map((f) => (
              <Link key={f.slug} to="/case-study/$slug" params={{ slug: f.slug }} className="f0n-card">
                <img className="f0n-card-img" src={f.image} alt="" loading="lazy" />
                <span className="f0n-card-kicker">{f.stage}</span>
                <h3>{f.title}</h3>
                <p>Explore flow</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <LegacyLinks paths={FLOWS.map((f) => `/case-study/${f.oldSlug}`)} />
      <CtaBand />
    </>
  );
}
