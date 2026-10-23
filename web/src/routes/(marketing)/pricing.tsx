import { createFileRoute } from '@tanstack/react-router';
import { MovedNotice, pageHead } from '../../components/marketing/F0n';

/** vercel.json 301s this path; the prerendered stub is the meta-refresh fallback. */
export const Route = createFileRoute('/(marketing)/pricing')({
  head: () =>
    pageHead('Moved', 'This page has moved.', '/pricing', { noindex: true, refreshTo: '/compute-lanes' }),
  component: () => <MovedNotice to="/compute-lanes" />,
});
