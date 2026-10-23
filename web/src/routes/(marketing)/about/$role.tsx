import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { Eyebrow } from '../../../components/Eyebrow';
import { CtaBand, MovedNotice, PageHero, pageHead } from '../../../components/marketing/F0n';
import { PixelIcon } from '../../../components/PixelIcon';
import { OLD_ROLE_SLUGS, PRIMITIVES, ROLES } from '../../../content/about';

export const Route = createFileRoute('/(marketing)/about/$role')({
  loader: ({ params }) => {
    const moved = OLD_ROLE_SLUGS[params.role];
    if (moved) return { moved: `/about/${moved}`, role: null };
    const role = ROLES.find((r) => r.slug === params.role);
    if (!role) throw notFound();
    return { moved: null, role };
  },
  head: ({ loaderData, params }) => {
    if (loaderData?.moved)
      return pageHead('Moved', 'This page has moved.', `/about/${params.role}`, {
        noindex: true,
        refreshTo: loaderData.moved,
      });
    const r = loaderData?.role;
    return pageHead(
      r ? `${r.name}: network role` : 'Network role',
      r?.about.split('. ')[0] ?? '',
      `/about/${params.role}`,
    );
  },
  component: RolePage,
});

function RolePage() {
  const data = Route.useLoaderData();
  if (data.moved || !data.role) return <MovedNotice to={data.moved ?? '/about'} />;
  const r = data.role;
  return (
    <>
      <PageHero
        back={{ to: '/about', label: 'All network roles' }}
        eyebrow="Network role • Specification"
        title={r.name}
        lead={r.tag}
      />
      <section className="f0n-section">
        <div className="sp-container f0n-split">
          <div className="f0n-prose">
            <div>
              <h2>About this network role</h2>
              <p>{r.about}</p>
            </div>
            <div>
              <h2>The intended flow</h2>
              <ul className="f0n-list">
                {r.flow.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2>Design considerations</h2>
              <ul className="f0n-list">
                {r.considerations.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2>Shared network primitives</h2>
              <ul className="f0n-list">
                {PRIMITIVES.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          <dl className="f0n-aside">
            <div>
              <dt>Role</dt>
              <dd>{r.name}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{r.eyebrow}</dd>
            </div>
            <Link to={r.to} className="sp-cta sp-cta-secondary">
              <span>Explore this network role</span>
              <PixelIcon name="arrow" size={16} />
            </Link>
          </dl>
        </div>
      </section>
      <section className="f0n-section">
        <div className="sp-container">
          <div className="f0n-head">
            <Eyebrow tone="light">Explore the network roles</Eyebrow>
          </div>
          <div className="f0n-roles-list">
            {ROLES.filter((x) => x.slug !== r.slug).map((x) => (
              <Link key={x.slug} to="/about/$role" params={{ role: x.slug }}>
                <span>{x.name}</span>
                <span>{x.tag}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
