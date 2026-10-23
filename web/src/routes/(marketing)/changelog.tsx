import { createFileRoute } from '@tanstack/react-router';
import { CtaBand, PageHero, pageHead } from '../../components/marketing/F0n';
import { RELEASES } from '../../content/changelog';

export const Route = createFileRoute('/(marketing)/changelog')({
  head: () =>
    pageHead(
      'Changelog',
      'Build notes on the Spindle design: claims, receipts, node registry and the sealed lane.',
      '/changelog',
    ),
  component: Changelog,
});

function Changelog() {
  return (
    <>
      <PageHero
        eyebrow="Build note • Specification: October 10, 2026"
        title="Changelog"
        lead="What the Spindle design covers, by area."
      />
      <section className="f0n-section">
        <div className="sp-container">
          {RELEASES.map((r) => (
            <article key={r.id} className="f0n-release" id={r.id}>
              <div className="f0n-release-meta">
                <span>{r.tag}</span>
                <span>{r.date}</span>
              </div>
              <div>
                <h2>{r.title}</h2>
                <p className="f0n-muted">{r.summary}</p>
                <ul className="f0n-list">
                  {r.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>
      <CtaBand />
    </>
  );
}
