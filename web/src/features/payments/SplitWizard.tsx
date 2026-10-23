import { useEffect, useState } from 'react';
import type { Hash } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { CTA } from '../../components/CTA';
import { formatMicros } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { useCardOperation, useUsdgBalance } from '../card-funding/api';
import { formatUnitsTrim, parseAmount } from '../card-funding/lib';
import { useCards, useSummary } from '../shell/queries';
import { ClaimForm } from './ClaimForm';
import { FundForm } from './FundForm';
import { useStocks } from './queries';
import { SwapForm } from './SwapForm';

export type Plan = {
  claim: boolean;
  total: string;
  cardId: string;
  cardUsd: string;
  token: string;
  stockUsdg: string;
};
export type Progress = { plan: Plan; claimHash?: Hash; swapHash?: Hash };

const LS_KEY = 'spindle.split.v1';

export function loadProgress(): Progress | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Progress) : null;
  } catch {
    return null;
  }
}
function saveProgress(p: Progress | null) {
  try {
    if (p) localStorage.setItem(LS_KEY, JSON.stringify(p));
    else localStorage.removeItem(LS_KEY);
  } catch {
    // UI convenience only; the API and chain stay the source of truth
  }
}

export type PlanCheck = { ok: boolean; errors: string[]; keptMicros: bigint | null };

/** Pure validation: parts must fit in the total, and the total in claimable (claiming) or the wallet. */
export function checkPlan(
  plan: Plan,
  ctx: { claimable: bigint; min: bigint; wallet: bigint | undefined },
): PlanCheck {
  const errors: string[] = [];
  const total = parseAmount(plan.total, 6);
  const card = plan.cardUsd.trim() === '' ? 0n : parseAmount(plan.cardUsd, 2);
  const stock = plan.stockUsdg.trim() === '' ? 0n : parseAmount(plan.stockUsdg, 6);
  if (total === null || total <= 0n) errors.push('Enter a total amount.');
  if (card === null) errors.push('Card amount is not a valid USD amount.');
  if (stock === null) errors.push('Stock amount is not a valid USDG amount.');
  if (total === null || card === null || stock === null) return { ok: false, errors, keptMicros: null };
  const parts = card * 10_000n + stock;
  if (parts === 0n) errors.push('Add an amount for the card or for a Stock Token.');
  if (parts > total) errors.push('The card and stock amounts add up to more than your total.');
  if (plan.claim) {
    if (total > ctx.claimable) errors.push(`You can claim at most ${formatMicros(ctx.claimable)} USDG.`);
    if (total < ctx.min) errors.push(`Minimum claim is ${formatMicros(ctx.min)} USDG.`);
  } else if (ctx.wallet !== undefined && total > ctx.wallet) {
    errors.push(`Your wallet has ${formatMicros(ctx.wallet)} USDG.`);
  }
  if (card > 0n && !plan.cardId) errors.push('Pick a card.');
  if (stock > 0n && !plan.token) errors.push('Pick a Stock Token.');
  return { ok: errors.length === 0, errors, keptMicros: total - parts };
}

type StepState = 'todo' | 'active' | 'pending' | 'confirmed' | 'failed';
const PILL: Record<StepState, { tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'; label: string }> = {
  todo: { tone: 'neutral', label: 'To do' },
  active: { tone: 'info', label: 'In progress' },
  pending: { tone: 'info', label: 'Confirming' },
  confirmed: { tone: 'ok', label: 'Confirmed' },
  failed: { tone: 'danger', label: 'Failed' },
};

function useTxStatus(hash: Hash | undefined): 'none' | 'pending' | 'confirmed' | 'failed' {
  const r = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });
  if (!hash) return 'none';
  if (r.data) return r.data.status === 'success' ? 'confirmed' : 'failed';
  if (r.isError) return 'failed';
  return 'pending';
}

function Setup({ onStart }: { onStart: (p: Progress) => void }) {
  const summary = useSummary();
  const cards = useCards();
  const stocks = useStocks();
  const bal = useUsdgBalance();
  const [plan, setPlan] = useState<Plan>({
    claim: true,
    total: '',
    cardId: '',
    cardUsd: '',
    token: '',
    stockUsdg: '',
  });
  const set = (patch: Partial<Plan>) => setPlan((p) => ({ ...p, ...patch }));
  if (summary.isPending || cards.isPending || stocks.isPending) return <Skeleton height={260} />;
  const usable = (cards.data ?? []).filter((c) => c.status === 'issued');
  const list = stocks.data ?? [];
  const claimable = BigInt(summary.data?.claimableMicros ?? '0');
  const min = BigInt(summary.data?.minClaimMicros ?? '0');
  const eff: Plan = {
    ...plan,
    cardId: plan.cardId || usable[0]?.id || '',
    token: plan.token || list[0]?.address || '',
  };
  const check = checkPlan(eff, { claimable, min, wallet: bal.data });
  const showErrors = plan.total !== '' || plan.cardUsd !== '' || plan.stockUsdg !== '';
  return (
    <div className="sd-split-setup">
      <p className="sd-sub">
        Split an amount between your card, a Stock Token and your wallet. Each step is a separate transaction
        that you sign and pay gas for; they run one at a time.
      </p>
      <label className="sd-check">
        <input type="checkbox" checked={plan.claim} onChange={(e) => set({ claim: e.target.checked })} />
        <span>
          Claim first (up to {formatMicros(claimable)} USDG claimable) — otherwise I use USDG already in my
          wallet{bal.data !== undefined ? ` (${formatMicros(bal.data)})` : ''}
        </span>
      </label>
      <div className="sd-field">
        <label htmlFor="split-total">Total to split (USDG)</label>
        <input
          id="split-total"
          className="sd-input"
          inputMode="decimal"
          placeholder="0.00"
          value={plan.total}
          onChange={(e) => set({ total: e.target.value })}
        />
      </div>
      <div className="sd-split-grid">
        <div className="sd-field">
          <label htmlFor="split-card">To card (USD)</label>
          <input
            id="split-card"
            className="sd-input"
            inputMode="decimal"
            placeholder="0.00"
            value={plan.cardUsd}
            onChange={(e) => set({ cardUsd: e.target.value })}
          />
          <select
            className="sd-input"
            aria-label="Card"
            value={eff.cardId}
            onChange={(e) => set({ cardId: e.target.value })}
          >
            {usable.length === 0 ? <option value="">No card</option> : null}
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                •••• {c.last4 ?? '----'}
              </option>
            ))}
          </select>
        </div>
        <div className="sd-field">
          <label htmlFor="split-stock">To Stock Token (USDG)</label>
          <input
            id="split-stock"
            className="sd-input"
            inputMode="decimal"
            placeholder="0.00"
            value={plan.stockUsdg}
            onChange={(e) => set({ stockUsdg: e.target.value })}
          />
          <select
            className="sd-input"
            aria-label="Stock Token"
            value={eff.token}
            onChange={(e) => set({ token: e.target.value })}
          >
            {list.length === 0 ? <option value="">None available</option> : null}
            {list.map((s) => (
              <option key={s.address} value={s.address}>
                {s.symbol}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="sd-sub">
        Kept in wallet:{' '}
        <strong>
          {check.keptMicros !== null && check.keptMicros >= 0n
            ? `${formatMicros(check.keptMicros)} USDG`
            : '—'}
        </strong>
        . Card top-ups add izipay and Relay fees on top; the exact cost is shown before you pay.
      </p>
      {showErrors && check.errors.length > 0 ? (
        <ul className="sd-warn" role="alert">
          {check.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <CTA icon="" disabled={!check.ok} onClick={() => onStart({ plan: eff })}>
        Start split
      </CTA>
    </div>
  );
}

export function SplitWizard({
  opId,
  onOp,
}: {
  opId: string | undefined;
  onOp: (id: string | undefined) => void;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setProgress(loadProgress());
    setReady(true);
  }, []);
  const update = (next: Progress | null) => {
    setProgress(next);
    saveProgress(next);
  };

  const claimTx = useTxStatus(progress?.claimHash);
  const swapTx = useTxStatus(progress?.swapHash);
  const op = useCardOperation(opId);
  const opStatus = op.data?.operation.status;

  if (!ready) return <Skeleton height={260} />;
  if (!progress) return <Setup onStart={(p) => update(p)} />;

  const { plan } = progress;
  const cardOn = parseAmount(plan.cardUsd || '0', 2) !== 0n;
  const stockOn = parseAmount(plan.stockUsdg || '0', 6) !== 0n;
  const stateOf = (kind: 'claim' | 'card' | 'swap'): StepState => {
    if (kind === 'claim')
      return claimTx === 'none'
        ? 'todo'
        : claimTx === 'pending'
          ? 'pending'
          : claimTx === 'confirmed'
            ? 'confirmed'
            : 'failed';
    if (kind === 'swap')
      return swapTx === 'none'
        ? 'todo'
        : swapTx === 'pending'
          ? 'pending'
          : swapTx === 'confirmed'
            ? 'confirmed'
            : 'failed';
    if (!opId) return 'todo';
    if (opStatus === 'completed') return 'confirmed';
    if (opStatus === 'failed' || opStatus === 'expired') return 'failed';
    return 'pending';
  };
  const steps = [
    ...(plan.claim ? [{ kind: 'claim' as const, label: 'Claim USDG to your wallet' }] : []),
    ...(cardOn ? [{ kind: 'card' as const, label: `Fund card with $${plan.cardUsd}` }] : []),
    ...(stockOn ? [{ kind: 'swap' as const, label: `Swap ${plan.stockUsdg} USDG to a Stock Token` }] : []),
  ].map((s) => ({ ...s, state: stateOf(s.kind) }));
  const currentIdx = steps.findIndex((s) => s.state !== 'confirmed');
  const allDone = currentIdx === -1;
  const current = steps[currentIdx];
  const states = steps.map((s, i) => (i === currentIdx && s.state === 'todo' ? 'active' : s.state));

  return (
    <div className="sd-split-run">
      <ol className="sd-fund-steps" aria-label="Split steps">
        {steps.map((s, i) => (
          <li key={s.kind} data-state={states[i] === 'todo' ? 'todo' : states[i]}>
            <div>
              <strong>
                {i + 1}. {s.label}
              </strong>
            </div>
            <StatusPill tone={PILL[states[i] as StepState].tone}>
              {PILL[states[i] as StepState].label}
            </StatusPill>
          </li>
        ))}
      </ol>
      {allDone ? (
        <div className="sd-done" role="status">
          <strong>Split complete. Every step is confirmed.</strong>
          <CTA
            variant="secondary"
            icon=""
            onClick={() => {
              update(null);
              onOp(undefined);
            }}
          >
            Start a new split
          </CTA>
        </div>
      ) : (
        <>
          {current?.kind === 'claim' ? (
            <ClaimForm
              initialAmount={plan.total}
              locked
              onClaimed={(h) => update({ ...progress, claimHash: h })}
            />
          ) : null}
          {current?.kind === 'card' ? (
            <FundForm
              opId={opId}
              onOp={(id) => onOp(id)}
              onReset={() => onOp(undefined)}
              initialCardId={plan.cardId}
              initialAmount={plan.cardUsd}
              locked
            />
          ) : null}
          {current?.kind === 'swap' ? (
            <SwapForm
              locked
              initialToken={plan.token}
              initialAmount={plan.stockUsdg}
              onSwapped={(h) => update({ ...progress, swapHash: h })}
            />
          ) : null}
          <CTA
            variant="ghost"
            icon=""
            onClick={() => {
              update(null);
              onOp(undefined);
            }}
          >
            Cancel split (completed steps stay done)
          </CTA>
        </>
      )}
      <p className="sd-sub">
        Kept in wallet:{' '}
        {formatUnitsTrim(
          BigInt(parseAmount(plan.total, 6) ?? 0n) -
            (parseAmount(plan.cardUsd || '0', 2) ?? 0n) * 10_000n -
            (parseAmount(plan.stockUsdg || '0', 6) ?? 0n),
          6,
        )}{' '}
        USDG
      </p>
    </div>
  );
}
