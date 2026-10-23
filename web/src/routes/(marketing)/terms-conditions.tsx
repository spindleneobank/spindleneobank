import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing/F0n';
import { LegalBody } from '../../features/marketing/p8/pages';

export const Route = createFileRoute('/(marketing)/terms-conditions')({
  head: () =>
    pageHead(
      'Terms & Conditions',
      'Preview terms for the Spindle website and its illustrative flows.',
      '/terms-conditions',
    ),
  component: () => <LegalBody slug="terms-conditions" />,
});
