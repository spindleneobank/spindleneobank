import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { CtaBand, MovedNotice, PageHero, pageHead } from '../../../components/marketing/F0n';
import { POSTS } from '../../../content/blogs';

export const Route = createFileRoute('/(marketing)/blogs/$slug')({
  loader: ({ params }) => {
    const old = POSTS.find((p) => p.oldSlug === params.slug);
    if (old) return { moved: `/blogs/${old.slug}`, post: null };
    const post = POSTS.find((p) => p.slug === params.slug);
    if (!post) throw notFound();
    return { moved: null, post };
  },
  head: ({ loaderData, params }) => {
    if (loaderData?.moved)
      return pageHead('Moved', 'This page has moved.', `/blogs/${params.slug}`, {
        noindex: true,
        refreshTo: loaderData.moved,
      });
    return pageHead(
      loaderData?.post?.title ?? 'Field note',
      loaderData?.post?.lead ?? '',
      `/blogs/${params.slug}`,
    );
  },
  component: Post,
});

function Post() {
  const data = Route.useLoaderData();
  if (data.moved || !data.post) return <MovedNotice to={data.moved ?? '/blogs'} />;
  const p = data.post;
  const related = POSTS.filter((x) => x.slug !== p.slug).slice(0, 3);
  return (
    <>
      <PageHero
        wide
        back={{ to: '/blogs', label: 'Back' }}
        eyebrow={p.category}
        title={p.title}
        lead={p.lead}
      />
      <section className="f0n-section">
        <div className="sp-container">
          <img className="f0n-cover" src={p.image} alt="" />
          <div className="f0n-split">
            <article className="f0n-article">
              {p.sections.map((s) => (
                <div key={s.heading}>
                  <h2>{s.heading}</h2>
                  <p>{s.body}</p>
                </div>
              ))}
            </article>
            <dl className="f0n-aside">
              <div>
                <dt>Prepared from</dt>
                <dd>Spindle specification</dd>
              </div>
              <div>
                <dt>{p.category}</dt>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{p.date}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-toolbar">
            <h2>Related posts</h2>
            <Link to="/blogs" className="sp-cta sp-cta-secondary">
              <span>Read all field notes</span>
            </Link>
          </div>
          <div className="f0n-grid-3">
            {related.map((x) => (
              <Link key={x.slug} to="/blogs/$slug" params={{ slug: x.slug }} className="f0n-card">
                <img className="f0n-card-img" src={x.image} alt="" loading="lazy" />
                <span className="f0n-card-kicker">{x.category}</span>
                <h3>{x.lead}</h3>
                <p>{x.title}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
