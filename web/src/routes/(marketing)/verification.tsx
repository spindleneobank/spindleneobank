import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing';
import { verificationMeta } from '../../content/marketing/verification';
import { OldTree } from '../../features/marketing/verification/OldTree';

export const Route = createFileRoute('/(marketing)/verification')({
  head: () => pageHead(verificationMeta),
  component: OldTree,
});
