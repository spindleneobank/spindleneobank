import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Preloader } from '../components/Preloader';
import { SiteFooter } from '../components/SiteFooter';
import { SiteHeader } from '../components/SiteHeader';
import { ToastProvider } from '../components/Toast';
import appCss from '../styles/index.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Spindle: compute payouts, verified' },
      {
        name: 'description',
        content:
          'Spindle connects GPU supply to AI demand, records verified work, and pays providers in USDG.',
      },
      { name: 'theme-color', content: '#0e0c12' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/assets/brand/mark.svg' },
    ],
  }),
  component: RootComponent,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const isDashboard = useLocation({ select: (l) => l.pathname.startsWith('/dashboard') });
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {isDashboard ? (
            <Outlet />
          ) : (
            <>
              <Preloader />
              <SiteHeader />
              <main id="main">
                <Outlet />
              </main>
              <SiteFooter />
            </>
          )}
        </ToastProvider>
      </QueryClientProvider>
    </RootDocument>
  );
}
