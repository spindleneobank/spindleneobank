import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { CtaBand, LegacyLinks, PageHero, pageHead } from '../../../components/marketing/F0n';
import { POSTS, type Post } from '../../../content/blogs';

export const Route = createFileRoute('/(marketing)/blogs/')({
  head: () =>
    pageHead(
      'Compute field notes',
      'Explore the Spindle design: compute lanes, signed receipts, node identity and the path from GPU work to payout.',
      '/blogs',
    ),
  component: Blogs,
});

const CATS = ['All', 'Architecture', 'Compute', 'Claim flow'] as const;

function Blogs() {
  const [cat, setCat] = useState<(typeof CATS)[number]>('All');
  const [q, setQ] = useState('');
  const shown = POSTS.filter(
    (p: Post) =>
      (cat === 'All' || p.category === cat) && `${p.title} ${p.lead}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <PageHero
        eyebrow="Field notes & guides"
        title="Compute field notes"
        lead="Explore the Spindle design: compute lanes, signed receipts, node identity and the path from GPU work to payout."
      />
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-toolbar">
            <h2>Design notes</h2>
            <div className="f0n-actions" role="group" aria-label="Filter by category">
              {CATS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="f0n-chip"
                  aria-pressed={cat === c}
                  onClick={() => setCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <input
              className="f0n-search"
              type="search"
              placeholder="Search"
              aria-label="Search notes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="f0n-grid-3">
            {shown.map((p) => (
              <Link key={p.slug} to="/blogs/$slug" params={{ slug: p.slug }} className="f0n-card">
                <img className="f0n-card-img" src={p.image} alt="" />
                <span className="f0n-card-kicker">{p.category}</span>
                <h3>{p.title}</h3>
                <p>{p.lead}</p>
              </Link>
            ))}
          </div>
          {shown.length === 0 ? <p className="f0n-muted">No notes match.</p> : null}
        </div>
      </section>
      <LegacyLinks paths={POSTS.map((p) => `/blogs/${p.oldSlug}`)} />
      <CtaBand />
    </>
  );
}
