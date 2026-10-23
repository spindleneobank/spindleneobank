import { createFileRoute, Link } from '@tanstack/react-router';
import { CtaBand, LegacyLinks, PageHero, pageHead } from '../../../components/marketing/F0n';
import { PixelIcon } from '../../../components/PixelIcon';
import { COMPONENTS } from '../../../content/architecture';

export const Route = createFileRoute('/(marketing)/architecture/')({
  head: () =>
    pageHead(
      'Architecture',
      'The components behind node registration, AI requests, signed receipts and payout routing.',
      '/architecture',
    ),
  component: Architecture,
});

function Architecture() {
  return (
    <>
      <PageHero
        eyebrow="Specification preview"
        title="Explore the compute architecture"
        wide
        lead="The components behind node registration, AI requests, signed receipts and claims to your wallet."
      />
      <section className="f0n-section">
        <div className="sp-container f0n-grid-3">
          {COMPONENTS.map((c) => (
            <Link key={c.slug} to="/architecture/$slug" params={{ slug: c.slug }} className="f0n-card">
              <PixelIcon name={c.icon} size={36} className="f0n-icon-big" />
              <h3>{c.title}</h3>
              <p>{c.lead}</p>
            </Link>
          ))}
        </div>
      </section>
      <LegacyLinks paths={['/integrations', ...COMPONENTS.map((c) => `/integrations/${c.oldSlug}`)]} />
      <CtaBand />
    </>
  );
}
