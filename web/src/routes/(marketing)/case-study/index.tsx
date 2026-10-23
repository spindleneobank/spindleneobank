import { createFileRoute } from '@tanstack/react-router';
import { LegacyLinks } from '../../../components/marketing/F0n';
import { FLOWS } from '../../../content/case-study';
import { CaseIndexPage } from '../../../features/marketing/p7/CasePages';
import { routeHead } from '../../../seo/head';

export const Route = createFileRoute('/(marketing)/case-study/')({
  head: () =>
    routeHead({
      title: 'Case studies',
      description:
        'Illustrative flows based on the Spindle design. They explain architecture and payout choices, not customer results.',
      path: '/case-study',
    }),
  component: CaseStudies,
});

function CaseStudies() {
  return (
    <>
      <CaseIndexPage />
      <LegacyLinks paths={FLOWS.map((f) => `/case-study/${f.oldSlug}`)} />
    </>
  );
}
