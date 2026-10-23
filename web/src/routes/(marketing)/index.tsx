import { createFileRoute } from '@tanstack/react-router';
import { ApiConsole } from '../../components/ApiConsole';
import { DashboardPreview } from '../../components/DashboardPreview';
import { Eyebrow } from '../../components/Eyebrow';
import { FAQ } from '../../components/FAQ';
import {
  ClosingCta,
  CtaRow,
  FeatureGrid,
  FlowDiagram,
  PageHero,
  pageHead,
  Reveal,
  StepList,
} from '../../components/marketing';
import { PixelIcon } from '../../components/PixelIcon';
import { Section } from '../../components/Section';
import { Tabs } from '../../components/Tabs';
import {
  apiBlock,
  capabilities,
  claimFlow,
  closing,
  evidence,
  faq,
  flows,
  hero,
  homeMeta,
  howItWorks,
  network,
  roles,
  specNotes,
} from '../../content/marketing/home';

export const Route = createFileRoute('/(marketing)/')({
  head: () => pageHead(homeMeta),
  component: Home,
});

function Home() {
  return (
    <>
      <PageHero
        eyebrow={hero.eyebrow}
        title={hero.title}
        lead={hero.lead}
        ctas={hero.ctas}
        aside={<DashboardPreview />}
      />

      <Section
        id="capabilities"
        eyebrow={capabilities.eyebrow}
        title={capabilities.title}
        lead={capabilities.lead}
      >
        <FeatureGrid items={capabilities.items} />
      </Section>

      <Section
        id="claim-flow"
        tone="paper"
        eyebrow={claimFlow.eyebrow}
        title={claimFlow.title}
        lead={claimFlow.lead}
      >
        <FlowDiagram nodes={claimFlow.nodes} branches={claimFlow.branches} />
      </Section>

      <Section id="roles" eyebrow={roles.eyebrow} title={roles.title}>
        <Tabs
          label="Network roles"
          items={roles.items.map((r) => ({
            id: r.id,
            label: r.label,
            content: (
              <div className="spm-role-body">
                <div>
                  <h3>{r.title}</h3>
                  <p className="sp-lead">{r.body}</p>
                  <ul className="spm-bullets">
                    {r.bullets.map((b) => (
                      <li key={b}>
                        <PixelIcon name="check" size={14} />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <CtaRow ctas={[r.cta]} />
                </div>
                <img src={r.image} alt={r.alt} loading="lazy" decoding="async" width={900} height={1125} />
              </div>
            ),
          }))}
        />
      </Section>

      <Section id="how-it-works" tone="night" eyebrow={howItWorks.eyebrow} title={howItWorks.title}>
        <StepList steps={howItWorks.steps} />
      </Section>

      <Section id="flows" eyebrow={flows.eyebrow} title={flows.title}>
        <ul className="spm-grid">
          {flows.items.map((f, i) => (
            <li key={f.tag}>
              <Reveal delay={i * 0.06} className="spm-card">
                <span className="spm-note-tag">Illustrative flow</span>
                <h3>{f.tag}</h3>
                <p>{f.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="network" eyebrow={network.eyebrow} title={network.title}>
        <ul className="spm-stats">
          {network.stats.map((s) => (
            <li key={s.label}>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="evidence"
        tone="night"
        eyebrow={evidence.eyebrow}
        title={evidence.title}
        lead={evidence.lead}
      >
        <FeatureGrid items={evidence.items.map((i) => ({ ...i, body: '' }))} />
      </Section>

      <Section id="api" tone="night" eyebrow={apiBlock.eyebrow} title={apiBlock.title} lead={apiBlock.body}>
        <div className="spm-home-preview">
          <ApiConsole />
          <CtaRow ctas={[apiBlock.cta]} />
        </div>
      </Section>

      <Section id="notes" eyebrow={specNotes.eyebrow} title={specNotes.title}>
        <ul className="spm-grid">
          {specNotes.items.map((n, i) => (
            <li key={n.title}>
              <Reveal delay={i * 0.06} className="spm-card">
                <span className="spm-note-tag">{n.tag}</span>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <section className="sp-section sp-section-night" aria-labelledby="faq-title">
        <div className="sp-container spm-faq-wrap">
          <div>
            <Eyebrow tone="light">FAQ</Eyebrow>
            <h2 id="faq-title">{faq.title}</h2>
          </div>
          <FAQ items={faq.items} />
        </div>
      </section>

      <ClosingCta {...closing} />
    </>
  );
}
