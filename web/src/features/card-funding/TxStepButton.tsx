import { useEffect, useRef } from 'react';
import type { Address, Hash, Hex, TransactionReceipt } from 'viem';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { CTA } from '../../components/CTA';
import { deriveTxState } from '../../components/TxButton';
import { explorerTx } from '../../config';

export type RawTx = { to: Address; data: Hex; value: string; chainId: number };

/** viem nests the wallet error up to 3 levels deep; surface a 4001 from any level as a plain rejection. */
function rejectionAware(error: unknown): unknown {
  let e = error as { code?: number; name?: string; cause?: unknown } | null | undefined;
  for (let i = 0; e && i < 6; i++) {
    if (e.code === 4001 || e.name === 'UserRejectedRequestError') return { code: 4001 };
    e = e.cause as typeof e;
  }
  return error;
}

const LABELS = {
  wallet: 'Confirm in wallet…',
  pending: 'Waiting for confirmation…',
  confirmed: 'Confirmed',
  reverted: 'Failed, try again',
} as const;

/**
 * Raw-transaction counterpart of the F0 TxButton (same state machine via deriveTxState) for Relay steps
 * whose calldata is prebuilt. `onBroadcast` fires once, as soon as the wallet returns a hash (so the
 * hash can be reported to the backend before the receipt); `onConfirmed` only for receipt status 1.
 */
export function TxStepButton({
  label,
  tx,
  onBroadcast,
  onConfirmed,
  disabled,
  variant = 'primary',
}: {
  label: string;
  tx: RawTx;
  onBroadcast?: (hash: Hash) => void;
  onConfirmed?: (receipt: TransactionReceipt) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const send = useSendTransaction();
  const wait = useWaitForTransactionReceipt({ hash: send.data });
  const state = deriveTxState({
    isSigning: send.isPending,
    writeError: rejectionAware(send.error),
    hash: send.data,
    receipt: wait.data,
    receiptError: wait.error,
  });
  const broadcast = useRef<string | null>(null);
  useEffect(() => {
    if (send.data && broadcast.current !== send.data) {
      broadcast.current = send.data;
      onBroadcast?.(send.data);
    }
  }, [send.data, onBroadcast]);
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (state === 'confirmed' && wait.data && fired.current !== wait.data.transactionHash) {
      fired.current = wait.data.transactionHash;
      onConfirmed?.(wait.data);
    }
  }, [state, wait.data, onConfirmed]);

  const busy = state === 'wallet' || state === 'pending';
  const text = state === 'idle' || state === 'rejected' ? label : LABELS[state];
  return (
    <div className="sp-tx" data-state={state === 'rejected' ? 'idle' : state} data-outcome={state}>
      <CTA
        variant={variant}
        icon=""
        disabled={disabled || busy || state === 'confirmed'}
        onClick={() => {
          send.reset();
          send.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value || '0'),
            chainId: tx.chainId,
          } as Parameters<typeof send.sendTransaction>[0]);
        }}
      >
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
