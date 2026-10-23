import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing';
import { lanesMeta } from '../../content/marketing/compute-lanes';
import { OldTree } from '../../features/marketing/compute-lanes/OldTree';

export const Route = createFileRoute('/(marketing)/compute-lanes')({
  head: () => pageHead(lanesMeta),
  component: OldTree,
});
