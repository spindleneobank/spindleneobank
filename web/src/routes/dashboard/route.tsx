import { createFileRoute } from '@tanstack/react-router';
import { DashboardShell } from '../../dashboard/Shell';

/** Client-only SPA subtree: `ssr: false` here applies to every /dashboard/* child. */
export const Route = createFileRoute('/dashboard')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Dashboard · Spindle' }, { name: 'robots', content: 'noindex' }] }),
  component: DashboardShell,
});
