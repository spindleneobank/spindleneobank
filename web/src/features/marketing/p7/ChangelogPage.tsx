import { CHANGELOG_HERO, RELEASES } from '../../../content/changelog';
import { Badge, Edge, Photo, Section } from './parts';

/** /changelog ("Build notes"): title block and four release rows. */
export function ChangelogPage() {
  return (
    <Section className="pg pg-hero">
      <div className="pg-cl-title">
        <div className="pg-container">
          <Badge label={CHANGELOG_HERO.badge} />
          <div>
            <h1 className="pg-h1">{CHANGELOG_HERO.title}</h1>
          </div>
          <div>
            <p className="pg-p">{CHANGELOG_HERO.lead}</p>
          </div>
        </div>
      </div>
      <div className="pg-cl-list">
        <Edge side="t" />
        <div className="pg-container">
          <div className="pg-cl-col">
            {RELEASES.map((r) => (
              <div className="pg-cl-entry" key={`${r.tag}-${r.heading}`}>
                <div className="pg-cl-side">
                  <div>
                    <h5 className="pg-h5">{r.title}</h5>
                  </div>
                  <div>
                    <p className="pg-label-14">{r.tag}</p>
                  </div>
                  <div className="pg-meta-date">
                    <p className="pg-meta">{r.date}</p>
                  </div>
                </div>
                <div className="pg-cl-wrap">
                  <div className="pg-cl-img">
                    <Photo img={r.img} className="pg-photo" />
                  </div>
                  <div className="pg-cl-text">
                    <div>
                      <h4 className="pg-h4">{r.heading}</h4>
                    </div>
                    <div>
                      <p className="pg-p">{r.summary}</p>
                    </div>
                    <div>
                      <ul className="pg-ul">
                        {r.items.map((i) => (
                          <li key={i}>
                            <p>{i}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
