import { createFileRoute } from '@tanstack/react-router';
import { LegacyLinks } from '../../../components/marketing/F0n';
import { POSTS } from '../../../content/blogs';
import { BlogsPage } from '../../../features/marketing/p7/BlogsPage';
import { routeHead } from '../../../seo/head';

export const Route = createFileRoute('/(marketing)/blogs/')({
  head: () =>
    routeHead({
      title: 'Compute field notes',
      description:
        'Explore the Spindle specification: compute lanes, signed receipts, bonded identity and the path from GPU work to payout choice.',
      path: '/blogs',
    }),
  component: Blogs,
});

function Blogs() {
  return (
    <>
      <BlogsPage />
      <LegacyLinks paths={POSTS.map((p) => `/blogs/${p.oldSlug}`)} />
    </>
  );
}
