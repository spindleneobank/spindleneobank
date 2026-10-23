import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing/F0n';
import { LegalPage } from '../../components/marketing/LegalPage';

export const Route = createFileRoute('/(marketing)/privacy-policy')({
  head: () =>
    pageHead(
      'Privacy Policy',
      'How the Spindle preview handles information, and what a production policy must cover.',
      '/privacy-policy',
    ),
  component: () => <LegalPage slug="privacy-policy" />,
});
