import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { BLOG_CATEGORIES, BLOGS_HERO, POSTS, type Post } from '../../../content/blogs';
import { Badge, Edge, Photo, Section, useHoverFill } from './parts';

/** Index card (also used for "Related posts"): kicker, bold line, muted line. */
export function PostCard({ post, img }: { post: Post; img: Post['cardImg'] }) {
  const hover = useHoverFill<HTMLDivElement>();
  return (
    <Link
      to="/blogs/$slug"
      params={{ slug: post.slug }}
      className="pg-card"
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
    >
      <div className="pg-card-in" ref={hover.ref}>
        <Edge side="b" />
        <Edge side="r" />
        <div className="pg-card-img">
          <Photo img={img} className="pg-photo" />
        </div>
        <div className="pg-card-text">
          <div>
            <p className="pg-label-14">{post.category}</p>
          </div>
          <div className="pg-card-text-in">
            <div>
              <p className="pg-card-bold">{post.bold}</p>
            </div>
            <div>
              <p className="pg-card-dim">{post.dim}</p>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

/** /blogs: title, category chips with search, and the 3-column post grid. */
export function BlogsPage() {
  const [cat, setCat] = useState<string>('All');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = POSTS.filter(
    (p) =>
      (cat === 'All' || p.category === cat) &&
      (needle === '' || `${p.category} ${p.bold} ${p.dim} ${p.title}`.toLowerCase().includes(needle)),
  );
  return (
    <Section className="pg pg-hero pg-bi">
      <div className="pg-bi-title">
        <Edge side="b" />
        <div className="pg-container">
          <div className="pg-bi-intro">
            <Badge label={BLOGS_HERO.badge} />
            <div>
              <h1 className="pg-h1">{BLOGS_HERO.title}</h1>
            </div>
            <div>
              <p className="pg-p">{BLOGS_HERO.lead}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="pg-bi-search">
        <div className="pg-container">
          <div>
            <h2 className="pg-h2">{BLOGS_HERO.heading}</h2>
          </div>
          <div className="pg-bi-tools">
            <div className="pg-chips" role="group" aria-label="Filter by category">
              {BLOG_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="pg-chip"
                  aria-pressed={cat === c}
                  onClick={() => setCat(c)}
                >
                  <span className="pg-col">
                    <p className="pg-label-14">{c}</p>
                  </span>
                </button>
              ))}
            </div>
            <div className="pg-chip-line" aria-hidden="true" />
            <label className="pg-find">
              <input
                type="text"
                name="search"
                placeholder={BLOGS_HERO.search}
                aria-label="Search field notes"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>
      <div className="pg-bi-grid-band">
        <Edge side="t" />
        <Edge side="b" />
        <div className="pg-container">
          <div className="pg-grid">
            {shown.map((p) => (
              <PostCard key={p.slug} post={p} img={p.cardImg} />
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
