import { ABOUT_BUILD, ABOUT_IDEA, ABOUT_TEAM, ABOUT_VALUES, ROLES } from '../../../content/about';
import { Badge, Duo, LinkedIn, RevealText, RoleLink, RollButton, Tag, TitleBlock } from './ui';

const TICKS = Array.from({ length: 33 }, (_, i) => i);

export function AboutPage() {
  return (
    <div className="ab">
      <section className="ab-sec" data-framer-name="Hero Section" style={{ background: '#0c0c10' }}>
        <div className="ab-hero">
          <div className="ab-hero-img">
            <Duo src="/assets/stock/inside-glass-v10.webp" tone="orchid" />
          </div>
          <div className="ab-hero-c">
            <div className="ab-hero-t">
              <Badge tone="black">About Spindle</Badge>
              <h1>We connect GPU work to a payout you can choose</h1>
            </div>
            <RollButton href="#career">Explore network roles</RollButton>
          </div>
        </div>
        <div className="ab-idea">
          <div className="ab-idea-c">
            <Badge tone="black">The idea</Badge>
            <RevealText paragraphs={ABOUT_IDEA} />
          </div>
          <Tag n="02" label="Compute lanes" left="35%" top="20%" speed={0.1} />
          <Tag n="03" label="Payout routes" left="75%" top="20%" speed={0.05} />
          <Tag n="M1" label="Specification build order" left="75%" top="80%" speed={0.05} />
        </div>
      </section>

      <section className="ab-sec" data-framer-name="Timeline Section">
        <TitleBlock badge="Build sequence" tone="white" title="How the design fits together" />
        <div className="ab-tl">
          <div className="ab-tl-grid">
            {ABOUT_BUILD.map((b) => (
              <div className="ab-tl-i" key={b.n}>
                <div className="ab-tl-t">
                  <small>{b.n}</small>
                  <h3>{b.title}</h3>
                  <p>{b.body}</p>
                </div>
                <div className="ab-ticks" aria-hidden="true">
                  {TICKS.map((t) => (
                    <i key={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ab-sec ab-values" data-framer-name="Value Section">
        <TitleBlock
          badge="Values"
          tone="white"
          title="What guides the design, from node to claim"
          narrow="a"
        />
        <div className="ab-tl">
          <div className="ab-vgrid">
            {ABOUT_VALUES.map((v) => (
              <div className="ab-vi" key={v.title}>
                <div className="ab-vi-ico">
                  <img src={`/assets/pixel/${v.icon}.svg`} alt="" />
                </div>
                <div className="ab-vi-t">
                  <h6>{v.title}</h6>
                  <p>{v.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ab-sec ab-team" data-framer-name="Team Wrapper">
        <TitleBlock badge="Core network roles" tone="black" title="The roles behind each job" narrow="b" />
        <div className="ab-team-w">
          <div className="ab-team-g">
            {ABOUT_TEAM.map((t) => (
              <div className="ab-tc" key={t.name}>
                <div className="ab-tc-img">
                  <Duo src={`/assets/stock/${t.image}.webp`} tone={t.filter} />
                  <img src={`/assets/pixel/${t.pixel}.svg`} alt="" />
                </div>
                <div className="ab-tc-a">
                  <div className="ab-tc-n">
                    <p>{t.name}</p>
                    <LinkedIn />
                  </div>
                  <p>{t.blurb}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ab-sec ab-inside" data-framer-name="Team Culture Section">
        <div className="ab-inside-c">
          <div className="ab-inside-h">
            <Badge tone="white">NETWORK DESIGN</Badge>
            <h2 className="ab-h2 is-narrow">Inside Spindle</h2>
          </div>
          <div className="ab-pics">
            <div className="ab-pic ab-pic-1">
              <Duo src="/assets/stock/inside-refraction-v10.webp" tone="orchid" />
            </div>
            <div className="ab-pic ab-pic-2">
              <Duo src="/assets/stock/inside-copper-v10.webp" tone="ember" />
            </div>
          </div>
        </div>
      </section>

      <section className="ab-sec ab-career" id="career" data-framer-name="Career Section">
        <TitleBlock badge="Network roles" tone="white" title="Explore the network roles" center />
        <div className="ab-rl-w">
          <div className="ab-rl">
            {ROLES.map((r) => (
              <RoleLink
                key={r.slug}
                slug={r.slug}
                name={r.name}
                design={r.list.design}
                state={r.list.state}
                category={r.list.category}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
