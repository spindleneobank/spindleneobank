import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing';
import { solutionsMeta } from '../../content/marketing/solutions';
import { SolutionsPage } from '../../features/marketing/solutions/SolutionsPage';

export const Route = createFileRoute('/(marketing)/solutions')({
  head: () => pageHead(solutionsMeta),
  component: SolutionsPage,
});
