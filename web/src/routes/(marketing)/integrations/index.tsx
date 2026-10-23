import { createFileRoute } from '@tanstack/react-router';
import { MovedNotice, pageHead } from '../../../components/marketing/F0n';

export const Route = createFileRoute('/(marketing)/integrations/')({
  head: () =>
    pageHead('Moved', 'This page has moved.', '/integrations', { noindex: true, refreshTo: '/architecture' }),
  component: () => <MovedNotice to="/architecture" />,
});
