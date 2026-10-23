import { createFileRoute } from '@tanstack/react-router';
import { ClosingCta, FeatureGrid, PageHero, pageHead, SplitFeature } from '../../components/marketing';
import { Section } from '../../components/Section';
import { closing } from '../../content/marketing/home';
import { foundation, roleBlocks, solutionsHero, solutionsMeta } from '../../content/marketing/solutions';

export const Route = createFileRoute('/(marketing)/solutions')({
  head: () => pageHead(solutionsMeta),
  component: Solutions,
});

function Solutions() {
  const { chips, ...hero } = solutionsHero;
  return (
    <>
      <PageHero
        {...hero}
        extra={
          <ul className="spm-chips">
            {chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        }
      />
      {roleBlocks.map((r, i) => (
        <SplitFeature key={r.id} {...r} flip={i % 2 === 1} tone={i % 2 === 0 ? 'paper' : 'night'} />
      ))}
      <Section id="foundation" eyebrow={foundation.eyebrow} title={foundation.title}>
        <FeatureGrid items={foundation.items} />
      </Section>
      <ClosingCta {...closing} />
    </>
  );
}
