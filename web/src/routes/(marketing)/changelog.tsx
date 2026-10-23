import { createFileRoute } from '@tanstack/react-router';
import { ChangelogPage } from '../../features/marketing/p7/ChangelogPage';
import { routeHead } from '../../seo/head';

export const Route = createFileRoute('/(marketing)/changelog')({
  head: () =>
    routeHead({
      title: 'Build notes',
      description: 'Build notes on the Spindle design: claims, receipts, node registry and the sealed lane.',
      path: '/changelog',
    }),
  component: ChangelogPage,
});
