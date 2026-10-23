import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing';
import { homeMeta } from '../../content/marketing/home';
import { HomePage } from '../../features/marketing/home/HomePage';

export const Route = createFileRoute('/(marketing)/')({
  head: () => pageHead(homeMeta),
  component: HomePage,
});
