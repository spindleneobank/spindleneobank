import { createFileRoute, notFound } from '@tanstack/react-router';
import { MovedNotice } from '../../../components/marketing/F0n';
import { FLOWS } from '../../../content/case-study';
import { CasePostPage } from '../../../features/marketing/p7/CasePages';
import { routeHead } from '../../../seo/head';

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
      return routeHead({
        title: 'Moved',
        description: 'This page has moved.',
        path: `/case-study/${params.slug}`,
        noindex: true,
        refreshTo: loaderData.moved,
      });
    return routeHead({
      title: loaderData?.flow?.title ?? 'Illustrative flow',
      description: loaderData?.flow?.stats ?? '',
      path: `/case-study/${params.slug}`,
    });
  },
  component: Flow,
});

function Flow() {
  const data = Route.useLoaderData();
  if (data.moved || !data.flow) return <MovedNotice to={data.moved ?? '/case-study'} />;
  return <CasePostPage flow={data.flow} />;
}
