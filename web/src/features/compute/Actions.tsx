import { spindleRegistryAbi, spindleStakingAbi } from '@spindle/shared/abi';
import type { NodeView } from '@spindle/shared/api';
import { type ReactNode, useRef, useState } from 'react';
import { erc20Abi, type Hash } from 'viem';
import { useAccount, useReadContract, useSwitchChain } from 'wagmi';
import { ApiError } from '../../api/errors';
import { useAuth } from '../../auth/useAuth';
import { CTA } from '../../components/CTA';
import { TxButton } from '../../components/TxButton';
import { chain, env, explorerTx } from '../../config';
import { fmtTime, useNow } from '../shell/ui';
import { fmtSpdl, parseSpdl, stakeState, WALLET_BLOCK_TEXT, type WalletBlock, walletBlock } from './format';
import { useRegisterCall, useStakeCall, useStakingParams } from './queries';

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Which on-chain fact the indexer must reflect before we claim success. */
export type Pending = { kind: 'register' | 'stake' | 'unstake' | 'complete'; hash: Hash; base: string };
export const chainSig = (n: Pick<NodeView, 'registered' | 'stake'>) =>
  `${n.registered}|${n.stake.active}|${n.stake.pending}`;

export function useWalletGate(): { block: WalletBlock; note: ReactNode } {
  const account = useAccount();
  const auth = useAuth();
  const { switchChain, isPending } = useSwitchChain();
  const block = walletBlock({
    address: account.address,
    isConnected: account.isConnected,
    chainId: account.chainId,
    sessionAddress: auth.session?.address,
    expectedChainId: chain.id,
  });
  const note = block ? (
    <div className="cp-gate" role="alert">
      <span>{WALLET_BLOCK_TEXT[block]}</span>
      {block === 'wrong-chain' ? (
        <CTA
          variant="secondary"
          icon=""
          disabled={isPending}
          onClick={() => switchChain({ chainId: chain.id })}
        >
          Switch network
        </CTA>
      ) : null}
      {block === 'no-wallet' ? (
        <CTA variant="secondary" icon="connect" onClick={auth.signIn}>
          Connect wallet
        </CTA>
      ) : null}
    </div>
  ) : null;
  return { block, note };
}

const TIMEOUT_MS = 180_000;

/** Confirmed on chain, now waiting for the backend indexer to reflect it. */
export function IndexerWait({ pending, done, label }: { pending: Pending; done: boolean; label: string }) {
  const started = useRef(Date.now());
  const now = useNow(1000);
  const timedOut = !done && now - started.current > TIMEOUT_MS;
  const link = (
    <a href={explorerTx(pending.hash)} target="_blank" rel="noreferrer noopener">
      View transaction
    </a>
  );
  if (done) {
    return (
      <p className="cp-ok" role="status">
        {label} {link}
      </p>
    );
  }
  if (timedOut) {
    return (
      <p className="cp-error" role="alert">
        The indexer has not picked this up after 3 minutes. Your transaction is confirmed on chain, so it
        should appear soon. Reload later, or check the transaction: {link}
      </p>
    );
  }
  return (
    <p className="cp-wait" role="status">
      Waiting for indexer… {link}
    </p>
  );
}

export function RegisterSection({
  node,
  pending,
  done,
  onSent,
}: {
  node: NodeView;
  pending: Pending | null;
  done: boolean;
  onSent: (p: Pending) => void;
}) {
  const { block, note } = useWalletGate();
  const call = useRegisterCall();
  const data = call.data;
  const err = call.error;
  const offline = err instanceof ApiError && (err.status === 409 || err.code === 'CHAIN_STATE');
  const wrongTarget = !!data && !sameAddr(data.to, env.addresses.registry);
  const reg = pending?.kind === 'register' ? pending : null;
  return (
    <div className="cp-section">
      <h3>Register on-chain</h3>
      <div className="cp-banner" role="alert">
        <strong>This node receives no jobs and earns nothing until it is registered.</strong>
        <span>
          Registration is one wallet transaction. The node signs its own key binding, you submit it from your
          wallet.
        </span>
      </div>
      {note}
      {!data && !reg ? (
        <CTA icon="registry" disabled={call.isPending || block !== null} onClick={() => call.mutate(node.id)}>
          {call.isPending ? 'Preparing…' : 'Prepare registration'}
        </CTA>
      ) : null}
      {call.isPending ? <p className="cp-wait">Asking the node for a fresh signature…</p> : null}
      {err ? (
        <p className="cp-error" role="alert">
          {offline ? 'Start the node so it can sign a fresh binding, then try again.' : err.message}
        </p>
      ) : null}
      {wrongTarget ? (
        <p className="cp-error" role="alert">
          The API returned an unexpected registry address. Do not send this transaction.
        </p>
      ) : null}
      {data && !wrongTarget && !reg ? (
        <TxButton
          label="Register node"
          disabled={block !== null}
          request={{
            address: env.addresses.registry,
            abi: spindleRegistryAbi,
            functionName: 'registerNode',
            args: [
              data.args[0],
              data.args[1],
              data.args[2],
              data.args[3],
              BigInt(data.args[4]),
              data.args[5],
            ],
          }}
          onConfirmed={(r) =>
            onSent({
              kind: 'register',
              hash: r.transactionHash,
              base: chainSig(node),
            })
          }
        />
      ) : null}
      {reg ? (
        <IndexerWait pending={reg} done={done} label="Registered. The node can now receive jobs." />
      ) : null}
    </div>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
}) {
  const invalid = value.trim() !== '' && parseSpdl(value) === null;
  return (
    <div className="cp-ctl">
      <label className="cp-ctl-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.0"
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid ? (
        <small className="cp-error">Enter a positive amount with up to 18 decimals.</small>
      ) : hint ? (
        <small className="cp-hint">{hint}</small>
      ) : null}
    </div>
  );
}

type StakeSectionProps = {
  node: NodeView;
  pending: Pending | null;
  done: boolean;
  onSent: (p: Pending) => void;
};

/** Hidden until SpindleStaking is deployed (`env.stakingEnabled`). */
export function StakeSection(props: StakeSectionProps) {
  const { staking, spdl } = env.addresses;
  if (!staking || !spdl) return null;
  return <StakeSectionLive {...props} staking={staking} spdl={spdl} />;
}

function StakeSectionLive({
  node,
  pending,
  done,
  onSent,
  staking,
  spdl,
}: StakeSectionProps & { staking: `0x${string}`; spdl: `0x${string}` }) {
  const { block, note } = useWalletGate();
  const params = useStakingParams();
  const now = useNow(1000);
  const [amountIn, setAmountIn] = useState('');
  const [unIn, setUnIn] = useState('');
  const [approved, setApproved] = useState(false);
  const [round, setRound] = useState(0);
  const stakeCall = useStakeCall();
  const amount = parseSpdl(amountIn);
  const unAmount = parseSpdl(unIn);
  const active = BigInt(node.stake.active);
  const pend = BigInt(node.stake.pending);
  const min = BigInt(node.stake.min);
  const state = stakeState(node);
  const onchainId = node.onchainId;

  const read = useReadContract({
    address: staking,
    abi: spindleStakingAbi,
    functionName: 'stakeOf',
    args: [BigInt(onchainId ?? 0)],
    query: { enabled: !env.mock && onchainId !== null && pend > 0n },
  });
  const chainUnlock = (() => {
    const r = read.data as readonly bigint[] | undefined;
    const v = r?.[2];
    return v && v > 0n ? new Date(Number(v) * 1000).toISOString() : null;
  })();
  const unlockAt = node.stake.unlockAt ?? chainUnlock;
  const unlocked = unlockAt !== null && Date.parse(unlockAt) <= now;
  const delayDays = params.data ? Math.round(params.data.unstakeDelay / 86400) : 7;

  const reset = () => {
    stakeCall.reset();
    setApproved(false);
    setRound((r) => r + 1);
  };
  const sp = (kind: Pending['kind']) => (pending?.kind === kind ? pending : null);
  const stakeData = stakeCall.data;
  const spdlOk = !stakeData?.approve || sameAddr(stakeData.approve.to, spdl);
  const stakeOk = !stakeData || sameAddr(stakeData.stake.to, staking);
  const targetsOk = spdlOk && stakeOk;
  const stakeStep = stakeData && targetsOk && (!stakeData.approve || approved);
  const afterUnstake = unAmount !== null && unAmount <= active ? active - unAmount : null;

  if (onchainId === null) return null;
  return (
    <div className="cp-section">
      <h3>Stake SPDL</h3>
      {state === 'unstaked' || state === 'below-min' ? (
        <p className="cp-info" role="note">
          Staking is optional. Staking at least {fmtSpdl(min)} SPDL puts this node in the priority tier.
          Unstaked nodes still serve jobs when no staked node is free.
        </p>
      ) : (
        <p className="cp-info" role="note">
          This node meets the {fmtSpdl(min)} SPDL minimum and is in the priority tier.
        </p>
      )}
      <dl className="sd-kv">
        <div>
          <dt>Active stake</dt>
          <dd>{fmtSpdl(active)} SPDL</dd>
        </div>
        <div>
          <dt>Unstaking</dt>
          <dd>
            {fmtSpdl(pend)} SPDL
            {pend > 0n && unlockAt ? <small className="cp-sub">unlocks {fmtTime(unlockAt)}</small> : null}
          </dd>
        </div>
        <div>
          <dt>Minimum (class {node.gpuClass})</dt>
          <dd>{fmtSpdl(min)} SPDL</dd>
        </div>
      </dl>
      {note}
      <div className="cp-steps">
        <AmountField
          id={`cp-stake-${node.id}`}
          label="Amount to stake (SPDL)"
          value={amountIn}
          onChange={(v) => {
            setAmountIn(v);
            reset();
          }}
          hint={active < min ? `${fmtSpdl(min - active)} SPDL more reaches the minimum.` : undefined}
        />
        {!stakeData ? (
          <CTA
            icon=""
            disabled={amount === null || block !== null || stakeCall.isPending}
            onClick={() => amount !== null && stakeCall.mutate({ id: node.id, amount: amount.toString() })}
          >
            {stakeCall.isPending ? 'Preparing…' : 'Prepare stake'}
          </CTA>
        ) : null}
        {stakeCall.isError ? (
          <p className="cp-error" role="alert">
            {stakeCall.error.message}
          </p>
        ) : null}
        {stakeData && !targetsOk ? (
          <p className="cp-error" role="alert">
            The API returned an unexpected contract address. Do not send this transaction.
          </p>
        ) : null}
        {stakeData && targetsOk && amount !== null ? (
          <ol className="cp-seq">
            {stakeData.approve ? (
              <li data-done={approved}>
                <span>1. Allow the staking contract to move {fmtSpdl(amount)} SPDL</span>
                <TxButton
                  key={`a${round}`}
                  label="Approve SPDL"
                  variant="secondary"
                  disabled={block !== null || approved}
                  request={{
                    address: spdl,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [staking, amount],
                  }}
                  onConfirmed={() => setApproved(true)}
                />
              </li>
            ) : null}
            <li data-done={!!sp('stake')}>
              <span>
                {stakeData.approve ? '2. ' : ''}Stake {fmtSpdl(amount)} SPDL
              </span>
              <TxButton
                key={`s${round}`}
                label="Stake"
                disabled={block !== null || !stakeStep}
                request={{
                  address: staking,
                  abi: spindleStakingAbi,
                  functionName: 'stake',
                  args: [BigInt(onchainId), amount],
                }}
                onConfirmed={(r) => {
                  onSent({ kind: 'stake', hash: r.transactionHash, base: chainSig(node) });
                  setAmountIn('');
                  stakeCall.reset();
                  setApproved(false);
                }}
              />
            </li>
          </ol>
        ) : null}
        {sp('stake') ? (
          <IndexerWait pending={sp('stake') as Pending} done={done} label="Stake recorded." />
        ) : null}
      </div>

      {active > 0n || pend > 0n ? (
        <div className="cp-steps">
          <h4>Unstake</h4>
          <p className="cp-hint">
            Unstaked SPDL is locked for {delayDays} days before you can withdraw it. Unstaking below the
            minimum moves this node out of the priority tier.
          </p>
          <AmountField
            id={`cp-unstake-${node.id}`}
            label="Amount to unstake (SPDL)"
            value={unIn}
            onChange={setUnIn}
            hint={`Up to ${fmtSpdl(active)} SPDL.`}
          />
          {unAmount !== null && unAmount > active ? (
            <small className="cp-error">That is more than the active stake.</small>
          ) : null}
          {afterUnstake !== null && afterUnstake < min ? (
            <small className="cp-hint">
              After this the node would have {fmtSpdl(afterUnstake)} SPDL, below the minimum.
            </small>
          ) : null}
          <TxButton
            key={`u${round}`}
            label={`Begin unstake (${delayDays}-day lock)`}
            variant="secondary"
            disabled={block !== null || unAmount === null || unAmount > active}
            request={{
              address: staking,
              abi: spindleStakingAbi,
              functionName: 'beginUnstake',
              args: [BigInt(onchainId), unAmount ?? 0n],
            }}
            onConfirmed={(r) => {
              onSent({ kind: 'unstake', hash: r.transactionHash, base: chainSig(node) });
              setUnIn('');
            }}
          />
          {sp('unstake') ? (
            <IndexerWait pending={sp('unstake') as Pending} done={done} label="Unstake started." />
          ) : null}
          {pend > 0n ? (
            <div className="cp-complete">
              <span>
                {fmtSpdl(pend)} SPDL
                {unlockAt
                  ? unlocked
                    ? ' is unlocked.'
                    : ` unlocks ${fmtTime(unlockAt)}.`
                  : ' is unlocking. Reading the unlock date…'}
              </span>
              <TxButton
                key={`c${round}`}
                label="Withdraw unlocked SPDL"
                disabled={block !== null || !unlocked}
                request={{
                  address: staking,
                  abi: spindleStakingAbi,
                  functionName: 'completeUnstake',
                  args: [BigInt(onchainId)],
                }}
                onConfirmed={(r) =>
                  onSent({ kind: 'complete', hash: r.transactionHash, base: chainSig(node) })
                }
              />
              {sp('complete') ? (
                <IndexerWait pending={sp('complete') as Pending} done={done} label="Withdrawal recorded." />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function LinkIdentity({ node }: { node: NodeView }) {
  const { block, note } = useWalletGate();
  const [agent, setAgent] = useState('');
  const valid = /^\d+$/.test(agent.trim());
  if (node.onchainId === null) return null;
  return (
    <details className="cp-section cp-link">
      <summary>Link on-chain identity (optional)</summary>
      <p className="cp-hint">
        Link this node to an ERC-8004 agent identity that you own, so the node's work history can be
        attributed to that identity. It does not change routing, stake or payouts, and you can skip it.
      </p>
      <div className="cp-ctl">
        <label className="cp-ctl-label" htmlFor={`cp-agent-${node.id}`}>
          Agent ID
        </label>
        <input
          id={`cp-agent-${node.id}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 42"
          value={agent}
          aria-invalid={agent !== '' && !valid}
          onChange={(e) => setAgent(e.target.value)}
        />
      </div>
      {note}
      <TxButton
        label="Link identity"
        variant="secondary"
        disabled={block !== null || !valid}
        request={{
          address: env.addresses.registry,
          abi: spindleRegistryAbi,
          functionName: 'linkIdentity',
          args: [BigInt(node.onchainId), valid ? BigInt(agent.trim()) : 0n],
        }}
      />
    </details>
  );
}

/** Re-render guard so a stale `done` never lingers when the pending tx changes. */
export function usePendingDone(node: NodeView | undefined, pending: Pending | null): boolean {
  if (!node || !pending) return false;
  if (pending.kind === 'register') return node.registered;
  return chainSig(node) !== pending.base;
}
