import { createFileRoute } from '@tanstack/react-router';
import { DashboardPreview } from '../../components/DashboardPreview';
import {
  ClosingCta,
  FeatureGrid,
  NetworkDiagram,
  PageHero,
  pageHead,
  StepList,
} from '../../components/marketing';
import { Section } from '../../components/Section';
import { closing } from '../../content/marketing/home';
import {
  capabilities,
  flow,
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
    <>
      <PageHero {...productHero} aside={<DashboardPreview />} />
      <Section id="you-get" eyebrow={youGet.eyebrow} title={youGet.title}>
        <FeatureGrid items={youGet.items} />
      </Section>
      <Section id="network" tone="night" eyebrow={networkDiagram.eyebrow} title={networkDiagram.title}>
        <NetworkDiagram nodes={networkDiagram.nodes} after={networkDiagram.after} />
      </Section>
      <Section id="capabilities" eyebrow={capabilities.eyebrow} title={capabilities.title}>
        <FeatureGrid items={capabilities.items} />
      </Section>
      <Section id="flow" tone="night" eyebrow={flow.eyebrow} title={flow.title} lead={flow.lead}>
        <StepList steps={flow.steps} />
      </Section>
      <Section id="how-it-works" eyebrow={onboarding.eyebrow} title={onboarding.title}>
        <StepList steps={onboarding.steps} />
      </Section>
      <ClosingCta {...closing} />
    </>
  );
}
