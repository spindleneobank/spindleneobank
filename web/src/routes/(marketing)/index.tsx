import { createFileRoute } from '@tanstack/react-router';
import { ApiConsole } from '../../components/ApiConsole';
import { Eyebrow } from '../../components/Eyebrow';
import { FAQ } from '../../components/FAQ';
import {
  ClosingCta,
  CtaRow,
  FeatureTabs,
  HowColumns,
  LightHero,
  Marquee,
  MediaBand,
  pageHead,
  Reveal,
} from '../../components/marketing';
import { PixelIcon } from '../../components/PixelIcon';
import { Section } from '../../components/Section';
import { Tabs } from '../../components/Tabs';
import { VideoPanel } from '../../components/VideoPanel';
import {
  apiBlock,
  claimFlow,
  closing,
  evidence,
  faq,
  featureTabs,
  flows,
  hero,
  homeMeta,
  howItWorks,
  howVisuals,
  marquee,
  network,
  receiptDemo,
  roles,
  specNotes,
} from '../../content/marketing/home';

export const Route = createFileRoute('/(marketing)/')({
  head: () => pageHead(homeMeta),
  component: Home,
});

function Home() {
  return (
    <div className="spm-page">
      <LightHero
        eyebrow={hero.eyebrow}
        title={hero.title}
        subtitle={hero.subtitle}
        lead={hero.lead}
        ctas={hero.ctas}
      />
      <MediaBand image={hero.image} alt={hero.imageAlt} />
      <Marquee items={marquee} />

      <Section
        id="capabilities"
        tone="paper"
        eyebrow="Capabilities"
        title="From GPU registration to payout choice. Four core capabilities, designed to work together."
      >
        <FeatureTabs items={featureTabs} receipt={receiptDemo} claim={claimFlow} />
      </Section>

      <section id="roles" className="sp-section spm-roles">
        <div className="sp-container">
          <header className="sp-section-head">
            <Eyebrow tone="dark">{roles.eyebrow}</Eyebrow>
            <h2>{roles.title}</h2>
          </header>
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
                  <VideoPanel
                    src={`/assets/media/${r.media}-desktop.mp4`}
                    poster={`/assets/media/${r.media}.webp`}
                    label={r.alt}
                  />
                </div>
              ),
            }))}
          />
        </div>
      </section>

      <Section id="how-it-works" tone="paper" eyebrow={howItWorks.eyebrow} title={howItWorks.title}>
        <HowColumns steps={howItWorks.steps} chips={howVisuals.receipt} payouts={howVisuals.payout} />
      </Section>

      <Section id="flows" tone="paper" eyebrow={flows.eyebrow} title={flows.title}>
        <ul className="spm-flows">
          {flows.items.map((f, i) => (
            <li key={f.tag}>
              <Reveal delay={i * 0.06} className="spm-flow-card spm-br">
                <span className="spm-note-tag">{f.tag}</span>
                <div>
                  {f.image ? (
                    <img src={f.image} alt="" loading="lazy" decoding="async" width={140} height={100} />
                  ) : null}
                  <blockquote>{f.body}</blockquote>
                </div>
                {f.stat ? (
                  <div className="spm-flow-foot">
                    <span>
                      Spindle network
                      <br />
                      Illustrative flow
                    </span>
                    <span>
                      <strong>{f.stat.value}</strong>
                      {f.stat.label}
                    </span>
                  </div>
                ) : (
                  <span className="spm-flow-dot" aria-hidden="true" />
                )}
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="network" tone="paper" eyebrow={network.eyebrow} title={network.title}>
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
        tone="paper"
        eyebrow={evidence.eyebrow}
        title={evidence.title}
        lead={evidence.lead}
      >
        <ul className="spm-evidence">
          {evidence.items.map((e, i) => (
            <li key={e.title} className="spm-br">
              <Reveal delay={i * 0.06}>
                <PixelIcon name={e.icon} size={44} />
                <p>{e.title}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="api" tone="night" eyebrow={apiBlock.eyebrow} title={apiBlock.title} lead={apiBlock.body}>
        <div className="spm-api-wrap">
          <ApiConsole />
          <CtaRow ctas={[apiBlock.cta]} />
        </div>
      </Section>

      <Section id="notes" tone="paper" eyebrow={specNotes.eyebrow} title={specNotes.title}>
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
    </div>
  );
}
