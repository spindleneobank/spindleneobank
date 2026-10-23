import { Link } from '@tanstack/react-router';
import {
  CASE_HERO,
  CASE_HERO_BADGE,
  CASE_HERO_IMG,
  CASE_LOGOS,
  FLOWS,
  type Flow as FlowData,
} from '../../../content/case-study';
import { Flow } from './PostPage';
import { ArrowLink, Badge, Edge, Photo, Section } from './parts';

/** /case-study: title, feature card, logo band and the 2-column flow grid. */
export function CaseIndexPage() {
  return (
    <>
      <Section className="pg pg-hero">
        <div className="pg-ci-hero">
          <div className="pg-container">
            <div className="pg-ci-intro">
              <Badge label={CASE_HERO.badge} />
              <div>
                <h1 className="pg-h1">{CASE_HERO.title}</h1>
              </div>
              <div>
                <p className="pg-p">{CASE_HERO.lead}</p>
              </div>
            </div>
            <div className="pg-ci-feature">
              <div className="pg-ci-feature-img">
                <div className="pg-ci-feature-photo">
                  <Photo img={CASE_HERO_IMG} className="pg-photo" />
                </div>
                <div className="pg-ci-feature-badge">
                  <img src={CASE_HERO_BADGE.src} alt={CASE_HERO_BADGE.alt} />
                </div>
              </div>
              <div className="pg-ci-feature-card">
                <div className="pg-ci-feature-bg">
                  <img src="/assets/pixel/network.svg" alt="" />
                </div>
                <div className="pg-ci-feature-overlay" />
                <div>
                  <h5 className="pg-h5">{CASE_HERO.statsHeading}</h5>
                </div>
                <div>
                  <p className="pg-meta">{CASE_HERO.stats}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>
      <Section className="pg pg-ci-logos">
        <Edge side="t" />
        <Edge side="b" />
        <div className="pg-ci-logos-in">
          {CASE_LOGOS.map((l, i) => (
            <img key={`${l.src}-${i}`} src={l.src} alt={l.alt} />
          ))}
        </div>
      </Section>
      <Section className="pg pg-ci-stories">
        <div className="pg-ci-stories-title">
          <div className="pg-container">
            <div>
              <h2 className="pg-h2">{CASE_HERO.heading}</h2>
            </div>
          </div>
        </div>
        <div className="pg-bi-grid-band">
          <Edge side="t" />
          <Edge side="b" />
          <div className="pg-container">
            <div className="pg-grid pg-ci-grid">
              {FLOWS.map((f) => (
                <Link key={f.slug} to="/case-study/$slug" params={{ slug: f.slug }} className="pg-ci-card">
                  <div className="pg-ci-card-in">
                    <Edge side="b" />
                    <Edge side="r" />
                    <div className="pg-ci-card-photo">
                      <Photo img={f.cardImg} className="pg-photo" />
                      <div className="pg-ci-cover">
                        <div className="pg-ci-cover-bg" />
                        <div className="pg-ci-cover-logo">
                          <img src={f.cardLogo.src} alt={f.cardLogo.alt} />
                        </div>
                      </div>
                    </div>
                    <div className="pg-ci-card-text">
                      <div>
                        <h5 className="pg-h5">{f.cardTitle}</h5>
                      </div>
                      <div className="pg-cta-btn">
                        <div>
                          <p className="pg-label-14">{CASE_HERO.cta}</p>
                        </div>
                        <div className="pg-cta-icon">
                          <i />
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

/** An illustrative flow page: hero image with logo + stats, title, article and fact list. */
export function CasePostPage({ flow }: { flow: FlowData }) {
  return (
    <Section className="pg pg-hero pg-post">
      <div className="pg-cp-imgband">
        <Edge side="b" />
        <div className="pg-container">
          <div className="pg-cp-imgwrap">
            <Photo img={flow.hero} className="pg-photo" />
            <div className="pg-cp-fade" />
            <div className="pg-cp-over">
              <div className="pg-cp-over-in">
                <div className="pg-cp-logo" style={{ width: flow.logo.w }}>
                  <img src={flow.logo.src} alt={flow.logo.alt} style={{ objectFit: flow.logo.fit }} />
                </div>
                <div className="pg-cp-stats">
                  <div>
                    <p>{flow.stats}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="pg-post-title">
        <div className="pg-container">
          <div className="pg-post-titlein">
            <div>
              <ArrowLink to="/case-study" label="Back" dir="back" />
            </div>
            <div>
              <h1 className="pg-h1">{flow.title}</h1>
            </div>
          </div>
        </div>
      </div>
      <div className="pg-post-bodyband">
        <Edge side="t" />
        <Edge side="b" />
        <div className="pg-container">
          <div className="pg-post-content pg-case-content">
            <Flow blocks={flow.body} />
          </div>
          <div className="pg-post-aside">
            <Edge side="l" />
            {flow.aside.map((a) => (
              <div key={a.label}>
                <div className="pg-aside-item">
                  <div>
                    <p className="pg-aside-head">{a.label}</p>
                  </div>
                  <div>
                    <p className="pg-aside-text">{a.value}</p>
                  </div>
                </div>
              </div>
            ))}
            <div className="pg-aside-block pg-aside-block-s">
              <div>
                <p className="pg-aside-head">Design facts</p>
              </div>
              <div>
                <ul className="pg-ul pg-ul-facts">
                  {flow.facts.map((f) => (
                    <li key={f.strong}>
                      <p>
                        <strong>{f.strong}</strong> {f.text}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
