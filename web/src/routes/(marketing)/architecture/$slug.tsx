import { createFileRoute, notFound } from '@tanstack/react-router';
import { pageHead } from '../../../components/marketing/F0n';
import { ARCH_COMPONENTS } from '../../../features/marketing/p8/data';
import { ArchitectureDetail } from '../../../features/marketing/p8/pages';

export const Route = createFileRoute('/(marketing)/architecture/$slug')({
  loader: ({ params }) => {
    const c = ARCH_COMPONENTS.find((x) => x.slug === params.slug);
    if (!c) throw notFound();
    return { c };
  },
  head: ({ loaderData, params }) =>
    pageHead(loaderData?.c.title ?? 'Architecture', loaderData?.c.lead ?? '', `/architecture/${params.slug}`),
  component: () => {
    const { c } = Route.useLoaderData();
    return <ArchitectureDetail c={c} />;
  },
});
