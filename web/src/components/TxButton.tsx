import { useEffect, useRef } from 'react';
import type { Abi, Address, Hash, TransactionReceipt } from 'viem';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { explorerTx } from '../config';
import { CTA } from './CTA';

export const TX_STATES = ['idle', 'wallet', 'pending', 'confirmed', 'reverted', 'rejected'] as const;
export type TxState = (typeof TX_STATES)[number];

export type TxRequest = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; name?: string; cause?: { code?: number; name?: string } } | null;
  return (
    !!e &&
    (e.code === 4001 ||
      e.cause?.code === 4001 ||
      e.name === 'UserRejectedRequestError' ||
      e.cause?.name === 'UserRejectedRequestError')
  );
}

export type TxInputs = {
  isSigning: boolean;
  writeError: unknown;
  hash?: Hash;
  receipt?: Pick<TransactionReceipt, 'status'>;
  receiptError?: unknown;
};

/**
 * Pure derivation of the button state machine:
 * idle -> wallet (awaiting signature) -> pending (hash + explorer link) -> confirmed | reverted.
 * A user rejection (4001) is `rejected`: the button is immediately usable again as idle (see TxButton).
 * `confirmed` requires a receipt whose status is success (1); a reverted receipt is never confirmed.
 */
export function deriveTxState({ isSigning, writeError, hash, receipt, receiptError }: TxInputs): TxState {
  if (writeError) return isUserRejection(writeError) ? 'rejected' : 'reverted';
  if (isSigning) return 'wallet';
  if (receipt) return receipt.status === 'success' ? 'confirmed' : 'reverted';
  if (receiptError) return 'reverted';
  if (hash) return 'pending';
  return 'idle';
}

const LABELS: Record<TxState, string> = {
  idle: '',
  wallet: 'Confirm in wallet…',
  pending: 'Waiting for confirmation…',
  confirmed: 'Confirmed',
  reverted: 'Failed, try again',
  rejected: '',
};

export function TxButton({
  label,
  request,
  onConfirmed,
  disabled,
  variant = 'primary',
}: {
  label: string;
  request: TxRequest;
  onConfirmed?: (receipt: TransactionReceipt) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const write = useWriteContract();
  const wait = useWaitForTransactionReceipt({ hash: write.data });
  const state = deriveTxState({
    isSigning: write.isPending,
    writeError: write.error,
    hash: write.data,
    receipt: wait.data,
    receiptError: wait.error,
  });
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (state === 'confirmed' && wait.data && fired.current !== wait.data.transactionHash) {
      fired.current = wait.data.transactionHash;
      onConfirmed?.(wait.data);
    }
  }, [state, wait.data, onConfirmed]);

  const busy = state === 'wallet' || state === 'pending';
  const start = () => {
    write.reset();
    write.writeContract({
      address: request.address,
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
      value: request.value,
    } as Parameters<typeof write.writeContract>[0]);
  };
  // A rejection returns the control to idle: same label, plus a note.
  const text = state === 'idle' || state === 'rejected' ? label : LABELS[state];
  return (
    <div className="sp-tx" data-state={state === 'rejected' ? 'idle' : state} data-outcome={state}>
      <CTA variant={variant} icon="" disabled={disabled || busy || state === 'confirmed'} onClick={start}>
        {text}
      </CTA>
      {state === 'rejected' ? (
        <small className="sp-tx-note">Signature rejected. Nothing was sent.</small>
      ) : null}
      {write.data ? (
        <a className="sp-tx-link" href={explorerTx(write.data)} target="_blank" rel="noreferrer noopener">
          View transaction
        </a>
      ) : null}
      {state === 'reverted' ? (
        <small className="sp-tx-note sp-tx-bad">The transaction did not succeed.</small>
      ) : null}
    </div>
  );
}
