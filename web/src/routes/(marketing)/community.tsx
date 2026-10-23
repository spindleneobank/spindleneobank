import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ComingSoonDialog } from '../../components/ComingSoonDialog';
import { CTA } from '../../components/CTA';
import { CtaBand, PageHero, pageHead } from '../../components/marketing/F0n';

export const Route = createFileRoute('/(marketing)/community')({
  head: () =>
    pageHead(
      'Community',
      'Follow Spindle’s compute and payout design. Community channels on Telegram and X are coming soon.',
      '/community',
    ),
  component: Community,
});

const STATS = [
  ['01', 'Lanes'],
  ['02', 'Routes'],
  ['03', 'Hour'],
  ['04', 'Chain'],
];

function Community() {
  const [what, setWhat] = useState<string | null>(null);
  return (
    <>
      <PageHero
        center
        eyebrow="Community"
        title="Follow the network"
        lead="Explore Spindle’s compute and payout design. Community links and launch details are coming soon."
      />
      <section className="f0n-section">
        <div className="sp-container f0n-grid-4">
          {STATS.map(([n, l]) => (
            <div key={n} className="f0n-step">
              <small>{n}</small>
              <h3>{l}</h3>
            </div>
          ))}
        </div>
      </section>
      <section className="f0n-section">
        <div className="sp-container f0n-head">
          <h2>Follow what takes shape.</h2>
          <p className="f0n-muted">
            Compute lanes. Signed receipts. Network design. Find Spindle on Telegram and X when the channels
            open.
          </p>
          <div className="f0n-actions">
            <CTA variant="secondary" icon="telegram" onClick={() => setWhat('The Telegram channel')}>
              <span className="f0n-soon">
                Telegram <em>COMING SOON</em>
              </span>
            </CTA>
            <CTA variant="secondary" icon="x" onClick={() => setWhat('The X account')}>
              <span className="f0n-soon">
                X <em>COMING SOON</em>
              </span>
            </CTA>
          </div>
        </div>
      </section>
      <ComingSoonDialog open={what !== null} onClose={() => setWhat(null)} what={what ?? 'This'} />
      <CtaBand />
    </>
  );
}
