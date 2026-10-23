import { useEffect, useRef, useState } from 'react';
import type { Address, Hex } from 'viem';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { CTA } from '../../components/CTA';
import { deriveTxState } from '../../components/TxButton';
import { env, explorerTx } from '../../config';

export type RawTx = { to: string; data: string; value: string; chainId: number };

/**
 * Relay returns ready-made calldata (approve, deposit), which the F0 TxButton cannot send because it only
 * accepts abi + functionName. This sibling reuses its state machine (`deriveTxState`) and look. It reports
 * `onConfirmed(hash)` only after a successful receipt. In mock mode (no wallet) it fakes a hash after a delay.
 */
export function RawTxButton({
  label,
  tx,
  disabled,
  onConfirmed,
}: {
  label: string;
  tx: RawTx;
  disabled?: boolean;
  onConfirmed: (hash: string) => void;
}) {
  const send = useSendTransaction();
  const wait = useWaitForTransactionReceipt({ hash: send.data });
  const [fake, setFake] = useState<'idle' | 'pending' | 'confirmed'>('idle');
  const real = deriveTxState({
    isSigning: send.isPending,
    writeError: send.error,
    hash: send.data,
    receipt: wait.data,
    receiptError: wait.error,
  });
  const state = env.mock ? (fake === 'idle' ? 'idle' : fake === 'pending' ? 'pending' : 'confirmed') : real;
  const fired = useRef(false);
  const hash = send.data ?? (fake === 'confirmed' ? `0x${'5'.repeat(64)}` : undefined);

  useEffect(() => {
    if (state === 'confirmed' && hash && !fired.current) {
      fired.current = true;
      onConfirmed(hash);
    }
  }, [state, hash, onConfirmed]);

  const busy = state === 'wallet' || state === 'pending';
  const start = () => {
    if (env.mock) {
      setFake('pending');
      setTimeout(() => setFake('confirmed'), 700);
      return;
    }
    send.reset();
    send.sendTransaction({
      to: tx.to as Address,
      data: tx.data as Hex,
      value: BigInt(tx.value || '0'),
      chainId: tx.chainId,
    });
  };
  const text =
    state === 'wallet'
      ? 'Confirm in wallet…'
      : state === 'pending'
        ? 'Waiting for confirmation…'
        : state === 'confirmed'
          ? 'Confirmed'
          : label;
  return (
    <div className="sp-tx" data-state={state === 'rejected' ? 'idle' : state} data-outcome={state}>
      <CTA variant="primary" icon="" disabled={disabled || busy || state === 'confirmed'} onClick={start}>
        {text}
      </CTA>
      {state === 'rejected' ? (
        <small className="sp-tx-note">Signature rejected. Nothing was sent.</small>
      ) : null}
      {send.data ? (
        <a className="sp-tx-link" href={explorerTx(send.data)} target="_blank" rel="noreferrer noopener">
          View transaction
        </a>
      ) : null}
      {state === 'reverted' ? (
        <small className="sp-tx-note sp-tx-bad">The transaction did not succeed.</small>
      ) : null}
    </div>
  );
}
