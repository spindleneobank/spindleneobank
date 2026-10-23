import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing/F0n';
import { NotFoundBody } from '../../features/marketing/p8/pages';

export const Route = createFileRoute('/(marketing)/404')({
  head: () => pageHead('Page not found', 'This route is outside the network.', '/404', { noindex: true }),
  component: NotFoundBody,
});
