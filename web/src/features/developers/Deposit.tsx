import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { z } from 'zod';
import { apiFetch } from '../../api/client';
import { CTA } from '../../components/CTA';
import { Money } from '../../components/Money';
import { PixelIcon } from '../../components/PixelIcon';
import { Skeleton } from '../../components/Skeleton';
import { TxButton } from '../../components/TxButton';
import { env, explorerTx } from '../../config';
import { Boundary } from '../shell/ui';
import { erc20Abi, vaultAbi } from './abi';
import { bk, useBuyer } from './queries';

const TIMEOUT_MS = 5 * 60_000;

type Pending = { baseline: bigint; hash: string; startedAt: number };

function parseAmount(v: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(v.trim())) return null;
  try {
    const n = parseUnits(v.trim(), 6);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

export function BalanceDeposit() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const [amount, setAmount] = useState('50');
  const [pending, setPending] = useState<Pending | null>(null);
  const [credited, setCredited] = useState<bigint | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const buyer = useBuyer(pending && !timedOut ? 3000 : false);

  const micros = parseAmount(amount);
  const walletBal = useReadContract({
    address: env.addresses.usdg,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const allowance = useReadContract({
    address: env.addresses.usdg,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, env.addresses.vault] : undefined,
    query: { enabled: !!address },
  });
  const enough = micros !== null && typeof walletBal.data === 'bigint' ? walletBal.data >= micros : true;
  const approved = micros !== null && typeof allowance.data === 'bigint' && allowance.data >= micros;
  const bal = buyer.data ? BigInt(buyer.data.balanceMicros) : null;

  // Success only once the backend balance reflects the deposit.
  useEffect(() => {
    if (pending && bal !== null && bal > pending.baseline) {
      setCredited(bal - pending.baseline);
      setPending(null);
    }
  }, [pending, bal]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setTimedOut(true), Math.max(0, pending.startedAt + TIMEOUT_MS - Date.now()));
    return () => clearTimeout(t);
  }, [pending]);

  const error =
    micros === null && amount !== ''
      ? 'Enter a positive amount with up to 6 decimals.'
      : !enough
        ? 'Amount exceeds your wallet USDG balance.'
        : null;

  return (
    <section className="sd-box dv-balance">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">PREPAID CREDIT</span>
          <h2>Balance</h2>
        </div>
        <PixelIcon name="wallet" size={21} />
      </div>
      <Boundary query={buyer} title="Balance" skeleton={<Skeleton height={120} />}>
        {(b) => {
          const total = BigInt(b.balanceMicros);
          const reserved = BigInt(b.reservedMicros);
          return (
            <dl className="dv-stats">
              <div>
                <dt>Balance</dt>
                <dd>
                  <strong className="sd-amount">
                    <Money micros={total} />
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Reserved</dt>
                <dd>
                  <Money micros={reserved} />
                </dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>
                  <Money micros={total - reserved} />
                </dd>
              </div>
            </dl>
          );
        }}
      </Boundary>
      <p className="dv-note">
        Prepaid credit is non-refundable. Each deposit is split on-chain: 80% funds providers, 20% goes to
        Spindle.
      </p>

      <div className="dv-deposit">
        <label className="dv-input">
          <span className="sd-label">Deposit USDG</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setCredited(null);
            }}
            aria-invalid={!!error}
            aria-describedby="dv-amount-help"
            placeholder="50"
          />
        </label>
        <p id="dv-amount-help" className={error ? 'dv-error' : 'dv-help'} role={error ? 'alert' : undefined}>
          {error ??
            (typeof walletBal.data === 'bigint'
              ? `Wallet balance: ${formatUnits(walletBal.data, 6)} USDG`
              : 'Wallet balance unavailable. Connect your wallet.')}
        </p>
        <div className="dv-tx">
          {micros !== null && !approved ? (
            <TxButton
              key={`approve-${micros}`}
              label={`1. Approve ${amount} USDG`}
              variant="secondary"
              disabled={!!error || !address}
              request={{
                address: env.addresses.usdg,
                abi: erc20Abi,
                functionName: 'approve',
                args: [env.addresses.vault, micros],
              }}
              onConfirmed={() => void allowance.refetch()}
            />
          ) : null}
          <TxButton
            key={`deposit-${micros}`}
            label={micros !== null && !approved ? '2. Deposit' : 'Deposit'}
            disabled={!!error || micros === null || !approved || !address || !!pending}
            request={{
              address: env.addresses.vault,
              abi: vaultAbi,
              functionName: 'deposit',
              args: [micros ?? 0n],
            }}
            onConfirmed={(r) => {
              setTimedOut(false);
              setCredited(null);
              setPending({ baseline: bal ?? 0n, hash: r.transactionHash, startedAt: Date.now() });
              void walletBal.refetch();
              void allowance.refetch();
            }}
          />
          {env.mock && micros !== null ? (
            <CTA
              variant="ghost"
              icon=""
              onClick={() => {
                void apiFetch('/v1/app/buyer/_mock-deposit', {
                  schema: z.object({}),
                  method: 'POST',
                  body: { amountMicros: micros.toString() },
                }).catch(() => undefined);
                setTimedOut(false);
                setCredited(null);
                setPending({ baseline: bal ?? 0n, hash: `0x${'e'.repeat(64)}`, startedAt: Date.now() });
              }}
            >
              Simulate deposit (mock)
            </CTA>
          ) : null}
        </div>

        {pending ? (
          <p className="dv-status" role="status">
            <PixelIcon name="hourly" size={14} /> Pending confirmations. Crediting after 12 confirmations…{' '}
            {timedOut ? null : (
              <a href={explorerTx(pending.hash)} target="_blank" rel="noreferrer noopener">
                View transaction
              </a>
            )}
          </p>
        ) : null}
        {pending && timedOut ? (
          <p className="dv-error" role="alert">
            Still not credited after 5 minutes. Your deposit is on-chain and will be credited once indexed;{' '}
            <a href={explorerTx(pending.hash)} target="_blank" rel="noreferrer noopener">
              check the transaction
            </a>
            .{' '}
            <button
              type="button"
              className="sd-link"
              onClick={() => {
                setTimedOut(false);
                setPending({ ...pending, startedAt: Date.now() });
                void qc.invalidateQueries({ queryKey: bk.buyer });
              }}
            >
              Keep waiting
            </button>
          </p>
        ) : null}
        {credited !== null ? (
          <p className="dv-ok" role="status">
            Credited <Money micros={credited} />. Your balance is updated.
          </p>
        ) : null}
      </div>
    </section>
  );
}
