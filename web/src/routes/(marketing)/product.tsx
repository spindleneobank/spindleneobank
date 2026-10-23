import { createFileRoute } from '@tanstack/react-router';
import {
  ClosingCta,
  DemoPanel,
  FeatureGrid,
  HowColumns,
  Marquee,
  MediaBand,
  NetworkDiagram,
  PageHero,
  pageHead,
  StepList,
} from '../../components/marketing';
import { Section } from '../../components/Section';
import { claimFlow, closing, howVisuals, marquee, receiptDemo } from '../../content/marketing/home';
import {
  capabilities,
  flow,
  heroBand,
  networkDiagram,
  onboarding,
  productHero,
  productMeta,
  youGet,
} from '../../content/marketing/product';

export const Route = createFileRoute('/(marketing)/product')({
  head: () => pageHead(productMeta),
  component: Product,
});

function Product() {
  return (
    <div className="spm-page">
      <PageHero {...productHero} />
      <MediaBand {...heroBand} />
      <Section id="you-get" tone="night" eyebrow={youGet.eyebrow} title={youGet.title}>
        <FeatureGrid items={youGet.items} />
      </Section>
      <Section id="capabilities" tone="night" eyebrow={capabilities.eyebrow} title={capabilities.title}>
        <div className="spm-caps">
          {capabilities.items.map((c, i) => (
            <article key={c.title} className="spm-cap" data-flip={i % 2 === 1 ? 'yes' : 'no'}>
              <div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
              <DemoPanel kind={c.panel} dark receipt={receiptDemo} claim={claimFlow} />
            </article>
          ))}
        </div>
      </Section>
      <Marquee items={marquee} />
      <Section id="flow" tone="night" eyebrow={flow.eyebrow} title={flow.title} lead={flow.lead}>
        <div className="spm-cap" data-flip="no">
          <StepList steps={flow.steps} />
          <DemoPanel kind="claim" dark receipt={receiptDemo} claim={claimFlow} />
        </div>
      </Section>
      <Section id="network" tone="night" eyebrow={networkDiagram.eyebrow} title={networkDiagram.title}>
        <NetworkDiagram nodes={networkDiagram.nodes} after={networkDiagram.after} />
      </Section>
      <Section id="how-it-works" tone="night" eyebrow={onboarding.eyebrow} title={onboarding.title}>
        <HowColumns dark steps={onboarding.steps} chips={howVisuals.receipt} payouts={howVisuals.payout} />
      </Section>
      <ClosingCta {...closing} />
    </div>
  );
}
