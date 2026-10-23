import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../../components/marketing/F0n';
import { ArchitectureIndex } from '../../../features/marketing/p8/pages';

export const Route = createFileRoute('/(marketing)/architecture/')({
  head: () =>
    pageHead(
      'Architecture',
      'The components behind node registration, AI requests, signed receipts and payout routing.',
      '/architecture',
    ),
  component: ArchitectureIndex,
});
