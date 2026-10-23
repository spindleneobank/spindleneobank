import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { MarketingShell } from '../components/marketing/shell';
import { Preloader } from '../components/Preloader';
import { ToastProvider } from '../components/Toast';
import appCss from '../styles/index.css?url';

/** First lines of the old preloader.js: arm the intro class before first paint (html.sp-intro shows #sp-preloader). */
const INTRO_SCRIPT = `(()=>{let seen=false;try{seen=sessionStorage.getItem('spindle-intro-v2')==='1'}catch{}const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;if(!reduced&&(!seen||new URLSearchParams(location.search).has('intro')))document.documentElement.classList.add('sp-intro')})()`;

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
    scripts: [{ children: INTRO_SCRIPT }],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/assets/brand/mark.svg' },
    ],
  }),
  component: RootComponent,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
              <MarketingShell>
                <Outlet />
              </MarketingShell>
            </>
          )}
        </ToastProvider>
      </QueryClientProvider>
    </RootDocument>
  );
}
