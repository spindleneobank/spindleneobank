import { createFileRoute, notFound } from '@tanstack/react-router';
import { MovedNotice } from '../../../components/marketing/F0n';
import { POSTS } from '../../../content/blogs';
import { PostPage } from '../../../features/marketing/p7/PostPage';
import { routeHead } from '../../../seo/head';

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
      return routeHead({
        title: 'Moved',
        description: 'This page has moved.',
        path: `/blogs/${params.slug}`,
        noindex: true,
        refreshTo: loaderData.moved,
      });
    return routeHead({
      title: loaderData?.post?.title ?? 'Field note',
      description: loaderData?.post?.bold ?? '',
      path: `/blogs/${params.slug}`,
    });
  },
  component: Post,
});

function Post() {
  const data = Route.useLoaderData();
  if (data.moved || !data.post) return <MovedNotice to={data.moved ?? '/blogs'} />;
  return <PostPage post={data.post} />;
}
