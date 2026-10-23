import { createFileRoute } from '@tanstack/react-router';
import { ClosingCta, PageHero, pageHead, SplitFeature } from '../../components/marketing';
import { Section } from '../../components/Section';
import { closing } from '../../content/marketing/home';
import {
  foundation,
  foundationImages,
  roleBlocks,
  solutionsHero,
  solutionsMeta,
} from '../../content/marketing/solutions';

export const Route = createFileRoute('/(marketing)/solutions')({
  head: () => pageHead(solutionsMeta),
  component: Solutions,
});

function Solutions() {
  const { chips, image, ...hero } = solutionsHero;
  return (
    <div className="spm-page">
      <PageHero
        {...hero}
        aside={
          <div className="spm-hero-media">
            <img src={image} alt="" width={900} height={700} decoding="async" />
            <ul className="spm-chips">
              {chips.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        }
      />
      <Section id="foundation" tone="night" eyebrow={foundation.eyebrow} title={foundation.title}>
        <ul className="spm-found">
          {foundation.items.map((f, i) => (
            <li key={f.title}>
              <img
                src={foundationImages[i]}
                alt=""
                loading="lazy"
                decoding="async"
                width={600}
                height={750}
              />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ul>
      </Section>
      {roleBlocks.map((r, i) => (
        <SplitFeature key={r.id} {...r} flip={i % 2 === 1} />
      ))}
      <ClosingCta {...closing} />
    </div>
  );
}
