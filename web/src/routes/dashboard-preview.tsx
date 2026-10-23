import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { PreviewDashboard } from '../features/marketing/home/preview/PreviewDashboard';

/** iframe target of the home hero lens and the footer card preview: the illustrative sample dashboard. */
export const Route = createFileRoute('/dashboard-preview')({
  validateSearch: (s: Record<string, unknown>): { view: 'overview' | 'cards' } => ({
    view: s.view === 'cards' ? 'cards' : 'overview',
  }),
  head: () => ({ meta: [{ title: 'Spindle dashboard preview' }, { name: 'robots', content: 'noindex' }] }),
  component: Preview,
});

function Preview() {
  const { view } = Route.useSearch();
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => {
      if (!live) return;
      document.documentElement.dataset.spPreviewReady = 'true';
      requestAnimationFrame(() => parent.postMessage({ type: 'spindle:preview-ready' }, location.origin));
    });
    return () => {
      live = false;
    };
  }, []);
  return <PreviewDashboard view={view} />;
}
