import { createFileRoute } from '@tanstack/react-router';
import { MovedNotice, pageHead } from '../../components/marketing/F0n';

/** vercel.json 301s this path; the prerendered stub is the meta-refresh fallback. */
export const Route = createFileRoute('/(marketing)/contact')({
  head: () =>
    pageHead('Moved', 'This page has moved.', '/contact', { noindex: true, refreshTo: '/verification' }),
  component: () => <MovedNotice to="/verification" />,
});
