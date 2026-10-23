import { createFileRoute, notFound } from '@tanstack/react-router';
import { MovedNotice, pageHead } from '../../../components/marketing/F0n';
import { OLD_ROLE_SLUGS, ROLES } from '../../../content/about';
import { RolePage } from '../../../features/marketing/about/RolePage';

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
  component: RoleRoute,
});

function RoleRoute() {
  const data = Route.useLoaderData();
  if (data.moved || !data.role) return <MovedNotice to={data.moved ?? '/about'} />;
  return <RolePage role={data.role} />;
}
