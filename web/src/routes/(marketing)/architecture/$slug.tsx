import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { CTA } from '../../../components/CTA';
import { CtaBand, PageHero, pageHead } from '../../../components/marketing/F0n';
import { PixelIcon } from '../../../components/PixelIcon';
import { COMPONENTS } from '../../../content/architecture';

export const Route = createFileRoute('/(marketing)/architecture/$slug')({
  loader: ({ params }) => {
    const c = COMPONENTS.find((x) => x.slug === params.slug);
    if (!c) throw notFound();
    return { c };
  },
  head: ({ loaderData, params }) =>
    pageHead(loaderData?.c.title ?? 'Architecture', loaderData?.c.lead ?? '', `/architecture/${params.slug}`),
  component: Component,
});

function Component() {
  const { c } = Route.useLoaderData();
  return (
    <>
      <PageHero
        back={{ to: '/architecture', label: 'All components' }}
        title={c.title}
        lead={c.lead}
        before={<PixelIcon name={c.icon} size={56} className="f0n-icon-big" />}
      />
      <section className="f0n-section">
        <div className="sp-container f0n-split">
          <div className="f0n-prose">
            <div>
              <h2>Data flow</h2>
              <p>{c.dataFlow}</p>
            </div>
            <div>
              <h2>Design boundary</h2>
              <p>{c.boundary}</p>
            </div>
            <div>
              <h2>How it fits</h2>
              <p>{c.fits}</p>
            </div>
            <div>
              <h2>Lifecycle</h2>
              <p>{c.lifecycle}</p>
            </div>
          </div>
          <dl className="f0n-aside">
            <div>
              <dt>Category</dt>
              <dd>{c.category}</dd>
            </div>
            <div>
              <dt>Records</dt>
              <dd>{c.records}</dd>
            </div>
            <div>
              <dt>Flow</dt>
              <dd>{c.flow}</dd>
            </div>
            <CTA to="/dashboard/overview" variant="secondary" icon="">
              Explore dashboard
            </CTA>
            <Link to="/architecture" className="f0n-back">
              All components
            </Link>
          </dl>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
