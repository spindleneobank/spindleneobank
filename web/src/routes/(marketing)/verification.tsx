import { createFileRoute } from '@tanstack/react-router';
import { Callout, ClosingCta, FeatureGrid, PageHero, pageHead, StepList } from '../../components/marketing';
import { PixelIcon } from '../../components/PixelIcon';
import { Section } from '../../components/Section';
import { closing } from '../../content/marketing/home';
import {
  community,
  evidenceSteps,
  limits,
  safeguards,
  verificationHero,
  verificationMeta,
} from '../../content/marketing/verification';

export const Route = createFileRoute('/(marketing)/verification')({
  head: () => pageHead(verificationMeta),
  component: Verification,
});

function Verification() {
  const { quote, ...hero } = verificationHero;
  return (
    <div className="spm-page">
      <PageHero
        {...hero}
        extra={
          <blockquote className="spm-hero-quote">
            “{quote}”<small>Spindle network / illustrative flow</small>
          </blockquote>
        }
        aside={
          <div className="spm-panel spm-br">
            <div>
              <small className="spm-note-tag">{evidenceSteps.eyebrow}</small>
              <h2>{evidenceSteps.title}</h2>
              <p>{evidenceSteps.lead}</p>
            </div>
            <div className="spm-steps">
              <StepList steps={evidenceSteps.steps} />
            </div>
            <Callout tone="warn">
              A receipt proves execution on the measured stack. It does not prove the output was correct.
              Open-lane work is visible to the operator.
            </Callout>
            <div className="spm-soon">
              {community.items.map((c) => (
                <div key={c.label}>
                  <PixelIcon name={c.icon} size={18} />
                  {c.label}
                  <small>{community.note}</small>
                </div>
              ))}
            </div>
          </div>
        }
      />
      <Section id="safeguards" tone="night" eyebrow={safeguards.eyebrow} title={safeguards.title}>
        <FeatureGrid items={safeguards.items} />
      </Section>
      <Section id="limits" tone="night" eyebrow={limits.eyebrow} title={limits.title}>
        <ul className="spm-limits">
          {limits.items.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>
      <ClosingCta {...closing} />
    </div>
  );
}
