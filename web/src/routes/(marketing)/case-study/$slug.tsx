import { createFileRoute, notFound } from '@tanstack/react-router';
import { CtaBand, MovedNotice, PageHero, pageHead } from '../../../components/marketing/F0n';
import { FLOWS } from '../../../content/case-study';

export const Route = createFileRoute('/(marketing)/case-study/$slug')({
  loader: ({ params }) => {
    const old = FLOWS.find((f) => f.oldSlug === params.slug);
    if (old) return { moved: `/case-study/${old.slug}`, flow: null };
    const flow = FLOWS.find((f) => f.slug === params.slug);
    if (!flow) throw notFound();
    return { moved: null, flow };
  },
  head: ({ loaderData, params }) => {
    if (loaderData?.moved)
      return pageHead('Moved', 'This page has moved.', `/case-study/${params.slug}`, {
        noindex: true,
        refreshTo: loaderData.moved,
      });
    return pageHead(
      loaderData?.flow?.title ?? 'Illustrative flow',
      loaderData?.flow?.start.slice(0, 160) ?? '',
      `/case-study/${params.slug}`,
    );
  },
  component: Flow,
});

function Flow() {
  const data = Route.useLoaderData();
  if (data.moved || !data.flow) return <MovedNotice to={data.moved ?? '/case-study'} />;
  const f = data.flow;
  return (
    <>
      <PageHero wide back={{ to: '/case-study', label: 'Back' }} eyebrow={f.stage} title={f.title} />
      <section className="f0n-section">
        <div className="sp-container">
          <img className="f0n-cover" src={f.image} alt="" />
          <div className="f0n-split">
            <article className="f0n-article">
              <div>
                <h2>The starting point</h2>
                <p>{f.start}</p>
              </div>
              <div>
                <h2>The intended flow</h2>
                <p>{f.flow}</p>
              </div>
              <div>
                <h2>Design outcome</h2>
                <p>{f.outcome}</p>
              </div>
            </article>
            <dl className="f0n-aside">
              <div>
                <dt>Network role</dt>
                <dd>{f.role}</dd>
              </div>
              <div>
                <dt>Design stage</dt>
                <dd>Specification</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>Illustrative flow</dd>
              </div>
              <div>
                <dt>Design facts</dt>
                {f.facts.map((x) => (
                  <dd key={x}>{x}</dd>
                ))}
              </div>
            </dl>
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
