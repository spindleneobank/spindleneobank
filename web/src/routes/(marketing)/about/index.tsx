import { createFileRoute, Link } from '@tanstack/react-router';
import { Eyebrow } from '../../../components/Eyebrow';
import { CtaBand, LegacyLinks, PageHero, pageHead } from '../../../components/marketing/F0n';
import { PixelIcon } from '../../../components/PixelIcon';
import { ABOUT_BUILD, ABOUT_VALUES, OLD_ROLE_SLUGS, ROLES } from '../../../content/about';

const PIXEL: Record<string, string> = {
  'api-developer': 'code',
  'node-operator': 'nodes',
  'gpu-provider': 'gpu',
  'payout-explorer': 'receipts',
};

export const Route = createFileRoute('/(marketing)/about/')({
  head: () =>
    pageHead(
      'About Spindle',
      'Spindle connects GPU supply to AI demand, records verified work and pays providers in USDG.',
      '/about',
    ),
  component: About,
});

/** Decorative dashed pixel-frame tag (as on the old About page). */
function PixelTag({ n, label, className }: { n: string; label: string; className: string }) {
  return (
    <div className={`f0n-pixtag ${className}`} aria-hidden="true">
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

function About() {
  return (
    <>
      <PageHero
        center
        wide
        eyebrow="About Spindle"
        title="We connect GPU work to a payout you can choose"
        media="/assets/stock/inside-glass-v10.webp"
      >
        <a href="#roles" className="sp-cta sp-cta-secondary">
          <span>Explore network roles</span>
        </a>
      </PageHero>
      <section className="f0n-section">
        <div className="sp-container f0n-idea-wrap">
          <div className="f0n-idea">
            <Eyebrow tone="light">The idea</Eyebrow>
            <p>
              Spindle connects GPU supply to AI demand. Providers register a node, serve suitable jobs and
              receive a signed record of the work.
            </p>
            <p>
              Verified earnings accrue in USDG. Hourly receipt roots support claims to your wallet. From the
              wallet you can fund a card or swap to a stock token from a curated list. The design keeps
              compute lanes, evidence and payout choice visible.
            </p>
          </div>
          <PixelTag className="is-a" n="02" label="Compute lanes" />
          <PixelTag className="is-b" n="03" label="Payout routes" />
          <PixelTag className="is-c" n="M1" label="Specification build order" />
        </div>
      </section>
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-head">
            <Eyebrow tone="light">Build sequence</Eyebrow>
            <h2>How the design fits together</h2>
          </div>
          <div className="f0n-grid-4">
            {ABOUT_BUILD.map((b) => (
              <div key={b.n} className="f0n-step">
                <small>{b.n}</small>
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-head">
            <Eyebrow tone="light">Values</Eyebrow>
            <h2>What guides the design, from node to claim</h2>
          </div>
          <div className="f0n-grid-2">
            {ABOUT_VALUES.map((v) => (
              <div key={v.title} className="f0n-value">
                <PixelIcon name={v.icon} size={36} />
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="f0n-section" id="roles">
        <div className="sp-container">
          <div className="f0n-head">
            <Eyebrow tone="light">Core network roles</Eyebrow>
            <h2>The roles behind each job</h2>
          </div>
          <div className="f0n-grid-4 f0n-roles-grid">
            {ROLES.map((r) => (
              <Link key={r.slug} to="/about/$role" params={{ role: r.slug }} className="f0n-card">
                <span className="f0n-role-art">
                  <img className="f0n-card-img" src={r.image} alt="" />
                  <img className="f0n-role-pixel" src={`/assets/pixel/${PIXEL[r.slug]}.svg`} alt="" />
                </span>
                <h3>{r.name}</h3>
                <p>{r.summary}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-head">
            <Eyebrow tone="light">Network design</Eyebrow>
            <h2>Inside Spindle</h2>
          </div>
          <div className="f0n-inside">
            <img src="/assets/stock/inside-glass-v10.webp" alt="" />
            <img src="/assets/stock/inside-copper-v10.webp" alt="" />
          </div>
        </div>
      </section>
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-head">
            <Eyebrow tone="light">Network roles</Eyebrow>
            <h2>Explore the network roles</h2>
          </div>
          <div className="f0n-roles-list">
            {ROLES.map((r) => (
              <Link key={r.slug} to="/about/$role" params={{ role: r.slug }}>
                <span>{r.name}</span>
                <span>{r.tag} / Preview</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <LegacyLinks paths={Object.keys(OLD_ROLE_SLUGS).map((s) => `/about/${s}`)} />
      <CtaBand />
    </>
  );
}
