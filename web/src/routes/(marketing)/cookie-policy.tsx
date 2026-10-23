import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing/F0n';
import { LegalPage } from '../../components/marketing/LegalPage';

export const Route = createFileRoute('/(marketing)/cookie-policy')({
  head: () =>
    pageHead('Cookie Policy', 'Cookies and local storage on the Spindle website.', '/cookie-policy'),
  component: () => <LegalPage slug="cookie-policy" />,
});
