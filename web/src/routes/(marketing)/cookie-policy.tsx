import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing/F0n';
import { LegalBody } from '../../features/marketing/p8/pages';

export const Route = createFileRoute('/(marketing)/cookie-policy')({
  head: () =>
    pageHead('Cookie Policy', 'Cookies and local storage on the Spindle website.', '/cookie-policy'),
  component: () => <LegalBody slug="cookie-policy" />,
});
