import type { ReactNode } from 'react';
import { useNetworkStats } from '../api/hooks';
import { CTA } from '../components/CTA';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { Stat } from '../components/Stat';
import { useAuth } from './useAuth';

function NetworkStrip() {
  const { data, isPending, isError, refetch } = useNetworkStats();
  if (isError) return <ErrorState title="Network stats unavailable" onRetry={() => void refetch()} />;
  return (
    <div className="sd-panel sd-strip" role="group" aria-label="Network stats">
      <Stat label="Nodes online" value={isPending ? <Skeleton width={48} height={28} /> : data.nodesOnline} />
      <Stat
        label="Jobs, 24h"
        value={isPending ? <Skeleton width={72} height={28} /> : data.jobs24h.toLocaleString('en-US')}
      />
      <Stat
        label="Tokens, 24h"
        value={isPending ? <Skeleton width={72} height={28} /> : data.tokens24h.toLocaleString('en-US')}
      />
      <Stat
        label="Latest epoch"
        value={isPending ? <Skeleton width={48} height={28} /> : (data.latestEpoch ?? 'none yet')}
      />
    </div>
  );
}

/** Signed out: connect empty state + read-only network strip. Signed in: children. */
export function SessionGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return (
      <div className="sd-panel" aria-busy="true">
        <Skeleton height={28} width="40%" />
        <Skeleton height={120} />
      </div>
    );
  }
  if (auth.status === 'error') {
    return (
      <ErrorState
        title="Could not reach the Spindle API"
        message={auth.error?.message}
        onRetry={() => void auth.retrySession()}
      />
    );
  }
  if (auth.status === 'signed-in') return <>{children}</>;
  return (
    <>
      <div className="sd-panel">
        {auth.status === 'mismatch' ? (
          <EmptyState
            icon="wallet"
            title="Wallet does not match your session"
            action={<CTA onClick={() => void auth.signOut()}>Sign out</CTA>}
          >
            Switch back to the wallet you signed in with, or sign out and connect the new one.
          </EmptyState>
        ) : (
          <EmptyState
            icon="wallet"
            title="Connect your wallet"
            action={<CTA onClick={auth.signIn}>Connect wallet</CTA>}
          >
            Sign in with your wallet to see earnings, cards and nodes. Signing is free and moves no funds.
          </EmptyState>
        )}
      </div>
      <NetworkStrip />
    </>
  );
}
