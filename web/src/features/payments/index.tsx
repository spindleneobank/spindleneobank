import type { ReactNode } from 'react';
import { useAuth } from '../../auth/useAuth';
import { formatMicros } from '../../components/Money';
import { PixelIcon } from '../../components/PixelIcon';
import { useUsdgBalance } from '../card-funding/api';
import { PageHead } from '../shell/ui';
import { ClaimForm } from './ClaimForm';
import { FundForm } from './FundForm';
import { usePaymentsNav, usePaymentsSearch } from './nav';
import { SplitWizard } from './SplitWizard';
import { SwapForm } from './SwapForm';
import './payments.css';

type Action = 'claim' | 'card' | 'swap' | 'split';
const TABS: { id: Action; label: string; icon: string }[] = [
  { id: 'claim', label: 'Claim', icon: 'claim' },
  { id: 'card', label: 'Fund card', icon: 'cards' },
  { id: 'swap', label: 'Swap to stock', icon: 'swap' },
  { id: 'split', label: 'Split', icon: 'payouts' },
];

function Panel({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <section className="sd-box sd-flat sd-pay-panel">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function PaymentsTab() {
  const search = usePaymentsSearch();
  const go = usePaymentsNav();
  const auth = useAuth();
  const bal = useUsdgBalance();
  const action: Action = search.action ?? 'claim';
  const setOp = (op: string | undefined) => go({ action, op }, true);

  return (
    <div className="sd-overview sd-payments">
      <PageHead eyebrow="PAYMENTS" line1="Turn earnings" line2="into money.">
        Claim USDG to your wallet, then fund your card or swap to a Stock Token. You sign and pay gas for
        every step.
      </PageHead>
      <div className="sd-pay-bar">
        <div className="sd-seg" role="group" aria-label="Payments">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={action === t.id}
              onClick={() => go({ action: t.id, op: t.id === action ? search.op : undefined })}
            >
              <PixelIcon name={t.icon} size={14} /> {t.label}
            </button>
          ))}
        </div>
        <span className="sd-sub" data-testid="wallet-usdg">
          Wallet USDG:{' '}
          <strong>
            {!auth.address
              ? 'wallet not connected'
              : bal.data === undefined
                ? '…'
                : `${formatMicros(bal.data)} USDG`}
          </strong>
        </span>
      </div>

      {action === 'claim' ? (
        <Panel eyebrow="STEP 1" title="Claim USDG">
          <ClaimForm />
        </Panel>
      ) : null}
      {action === 'card' ? (
        <Panel eyebrow="WALLET USDG TO CARD" title="Fund card">
          <FundForm opId={search.op} onOp={setOp} onReset={() => setOp(undefined)} />
        </Panel>
      ) : null}
      {action === 'swap' ? (
        <Panel eyebrow="WALLET USDG TO STOCK TOKEN" title="Swap to stock">
          <SwapForm />
        </Panel>
      ) : null}
      {action === 'split' ? (
        <Panel eyebrow="CLAIM, CARD, STOCK" title="Split wizard">
          <SplitWizard opId={search.op} onOp={setOp} />
        </Panel>
      ) : null}
    </div>
  );
}
