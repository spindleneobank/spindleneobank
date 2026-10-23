import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../../components/marketing/F0n';
import { AboutPage } from '../../../features/marketing/about/AboutPage';

export const Route = createFileRoute('/(marketing)/about/')({
  head: () =>
    pageHead(
      'About Spindle',
      'Spindle connects GPU supply to AI demand, records verified work and pays providers in USDG.',
      '/about',
    ),
  component: AboutPage,
});
