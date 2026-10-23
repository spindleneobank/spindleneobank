import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
  });
}

function NotFound() {
  return (
    <div className="sp-container sp-placeholder">
      <h1>Page not found</h1>
      <p className="sp-lead">That page does not exist or has moved.</p>
      <a href="/" className="sp-cta sp-cta-secondary">
        <span>Back home</span>
      </a>
    </div>
  );
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
