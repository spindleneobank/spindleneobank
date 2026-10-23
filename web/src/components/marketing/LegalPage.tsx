import { LEGAL_BY_SLUG } from '../../content/legal';
import { PageHero } from './F0n';

export function LegalPage({ slug }: { slug: string }) {
  const d = LEGAL_BY_SLUG[slug];
  if (!d) return null;
  return (
    <>
      <PageHero eyebrow={d.date} title={d.title} />
      <section className="f0n-section">
        <div className="sp-container f0n-legal">
          {d.sections.map((s) => (
            <div key={s.heading}>
              <h2>{s.heading}</h2>
              <p>{s.body}</p>
            </div>
          ))}
          <p>
            <a href="/verification">View verification</a>
          </p>
        </div>
      </section>
    </>
  );
}
