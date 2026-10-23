import { Link, Outlet, useParams } from '@tanstack/react-router';
import { Suspense, useState } from 'react';
import { useMe } from '../api/hooks';
import { SessionGate } from '../auth/SessionGate';
import { useAuth } from '../auth/useAuth';
import { PixelIcon } from '../components/PixelIcon';
import { Skeleton } from '../components/Skeleton';
import { openAccount, WalletProvider } from '../wallet/appkit';
import { TABS } from './tabs';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Chrome() {
  const [open, setOpen] = useState(false);
  const auth = useAuth();
  const signedIn = auth.status === 'signed-in';
  const me = useMe(signedIn);
  const params = useParams({ strict: false }) as { tab?: string };
  const tabs = TABS.filter((t) => !t.adminOnly || me.data?.isAdmin);
  return (
    <div className="sd-shell" data-nav={open ? 'open' : 'closed'}>
      <aside className="sd-sidebar" aria-label="Dashboard">
        <Link to="/" className="sd-brand">
          <img src="/assets/brand/mark.svg" alt="" width={26} height={26} />
          <span>Spindle</span>
        </Link>
        <nav className="sd-nav" aria-label="Dashboard tabs">
          {tabs.map((t) => (
            <Link
              key={t.id}
              to="/dashboard/$tab"
              params={{ tab: t.id }}
              className={params.tab === t.id ? 'active' : ''}
              onClick={() => setOpen(false)}
            >
              <PixelIcon name={t.icon} size={18} />
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="sd-sidebar-bottom">
          <span>ROBINHOOD CHAIN</span>
          <Link to="/">← Back to site</Link>
        </div>
      </aside>
      <div className="sd-main">
        <div className="sd-topbar">
          <button
            type="button"
            className="sd-menu-btn"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <PixelIcon name="menu" size={18} />
          </button>
          <span>Personal workspace / {params.tab ?? 'overview'}</span>
          <span className="sd-wallet">
            {signedIn && auth.session ? (
              <button type="button" className="sd-wallet-btn" onClick={() => void openAccount()}>
                {short(auth.session.address)}
              </button>
            ) : (
              <button type="button" className="sd-wallet-btn" onClick={auth.signIn}>
                Connect
              </button>
            )}
          </span>
        </div>
        <main className="sd-content" id="main">
          <SessionGate>
            <Suspense fallback={<Skeleton height={240} />}>
              <Outlet />
            </Suspense>
          </SessionGate>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell() {
  return (
    <WalletProvider>
      <Chrome />
    </WalletProvider>
  );
}
