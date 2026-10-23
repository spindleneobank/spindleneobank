import { createFileRoute, notFound } from '@tanstack/react-router';
import { MovedNotice, pageHead } from '../../../components/marketing/F0n';
import { COMPONENTS } from '../../../content/architecture';

/** Old Accrue-era slug. vercel.json issues the real 301; this prerendered page covers static preview servers. */
export const Route = createFileRoute('/(marketing)/integrations/$slug')({
  loader: ({ params }) => {
    const c = COMPONENTS.find((x) => x.oldSlug === params.slug);
    if (!c) throw notFound();
    return { to: `/architecture/${c.slug}` };
  },
  head: ({ loaderData, params }) =>
    pageHead('Moved', 'This page has moved.', `/integrations/${params.slug}`, {
      noindex: true,
      refreshTo: loaderData?.to,
    }),
  component: () => <MovedNotice to={Route.useLoaderData().to} />,
});
