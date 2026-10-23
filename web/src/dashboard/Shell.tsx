import { Link, Outlet, useParams } from '@tanstack/react-router';
import { Suspense, useState } from 'react';
import { useMe } from '../api/hooks';
import { SessionGate } from '../auth/SessionGate';
import { useAuth } from '../auth/useAuth';
import { PixelIcon } from '../components/PixelIcon';
import { Skeleton } from '../components/Skeleton';
import { ChainStatus, WrongChainBanner } from '../features/shell/WalletBar';
import { openAccount, WalletProvider } from '../wallet/appkit';
import { TABS } from './tabs';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Chrome() {
  const [open, setOpen] = useState(false);
  const auth = useAuth();
  const signedIn = auth.status === 'signed-in';
  const me = useMe(signedIn);
  const params = useParams({ strict: false }) as { tab?: string };
  const tab = params.tab ?? 'overview';
  const tabs = TABS.filter((t) => !t.adminOnly || me.data?.isAdmin);
  const connect =
    signedIn && auth.session ? (
      <button type="button" className="sd-btn sd-btn-wallet" onClick={() => void openAccount()}>
        <PixelIcon name="wallet" size={14} />
        {short(auth.session.address)}
      </button>
    ) : (
      <button type="button" className="sd-btn" onClick={auth.signIn}>
        <PixelIcon name="connect" size={14} />
        Connect
      </button>
    );
  return (
    <div className="sd-shell" data-nav={open ? 'open' : 'closed'}>
      <header className="sd-header">
        <div className="sd-header-inner">
          <Link to="/" className="sd-brand">
            <img src="/assets/brand/mark.svg" alt="" width={28} height={28} />
            <span>Spindle</span>
          </Link>
          <nav className="sd-nav" aria-label="Dashboard tabs">
            {tabs.map((t) => (
              <Link
                key={t.id}
                to="/dashboard/$tab"
                params={{ tab: t.id }}
                className={tab === t.id ? 'active' : ''}
                onClick={() => setOpen(false)}
              >
                <PixelIcon name={t.icon} size={16} />
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="sd-actions">
            {connect}
            {signedIn ? (
              <button
                type="button"
                className="sd-icon-btn"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => void auth.signOut()}
              >
                <PixelIcon name="logout" size={20} />
              </button>
            ) : null}
            <Link
              to="/dashboard/$tab"
              params={{ tab: 'settings' }}
              className="sd-icon-btn"
              aria-label="Settings"
            >
              <PixelIcon name="settings" size={20} />
            </Link>
            <button
              type="button"
              className="sd-icon-btn sd-menu-btn"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <PixelIcon name={open ? 'close' : 'menu'} size={20} />
            </button>
          </div>
        </div>
      </header>
      <div className="sd-crumbs">
        <span>
          <i aria-hidden="true" /> Personal workspace <b>/ {tabs.find((t) => t.id === tab)?.label ?? tab}</b>
        </span>
        <ChainStatus />
      </div>
      <main className="sd-content" id="main">
        {signedIn ? <WrongChainBanner /> : null}
        <SessionGate>
          <Suspense fallback={<Skeleton height={240} />}>
            <Outlet />
          </Suspense>
        </SessionGate>
      </main>
      <footer className="sd-foot">
        <Link to="/">
          <PixelIcon name="arrow-left" size={16} /> Back to the network
        </Link>
        <small>Spindle dashboard</small>
      </footer>
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
