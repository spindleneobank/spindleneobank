import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const write = {
  isPending: false,
  error: null as unknown,
  data: undefined as string | undefined,
  reset: vi.fn(),
  writeContract: vi.fn(),
};
const wait = { data: undefined as unknown, error: null as unknown };
vi.mock('wagmi', () => ({
  useWriteContract: () => write,
  useWaitForTransactionReceipt: () => wait,
}));

import { deriveTxState, TxButton } from '../TxButton';

const request = {
  address: '0x0000000000000000000000000000000000000001',
  abi: [],
  functionName: 'claim',
} as const;
const HASH = `0x${'a'.repeat(64)}`;

beforeEach(() => {
  Object.assign(write, { isPending: false, error: null, data: undefined });
  Object.assign(wait, { data: undefined, error: null });
  write.writeContract.mockReset();
});

describe('deriveTxState', () => {
  it('walks idle -> wallet -> pending -> confirmed', () => {
    expect(deriveTxState({ isSigning: false, writeError: null })).toBe('idle');
    expect(deriveTxState({ isSigning: true, writeError: null })).toBe('wallet');
    expect(deriveTxState({ isSigning: false, writeError: null, hash: HASH as `0x${string}` })).toBe(
      'pending',
    );
    expect(
      deriveTxState({
        isSigning: false,
        writeError: null,
        hash: HASH as `0x${string}`,
        receipt: { status: 'success' },
      }),
    ).toBe('confirmed');
  });
  it('never confirms a reverted receipt or a hash without a receipt', () => {
    expect(
      deriveTxState({
        isSigning: false,
        writeError: null,
        hash: HASH as `0x${string}`,
        receipt: { status: 'reverted' },
      }),
    ).toBe('reverted');
    expect(deriveTxState({ isSigning: false, writeError: null, hash: HASH as `0x${string}` })).not.toBe(
      'confirmed',
    );
  });
  it('treats code 4001 as a rejection', () => {
    expect(deriveTxState({ isSigning: false, writeError: { code: 4001 } })).toBe('rejected');
    expect(deriveTxState({ isSigning: false, writeError: { cause: { code: 4001 } } })).toBe('rejected');
    expect(deriveTxState({ isSigning: false, writeError: new Error('boom') })).toBe('reverted');
  });
});

describe('TxButton', () => {
  it('does not call onConfirmed while pending or when reverted', () => {
    const onConfirmed = vi.fn();
    write.data = HASH;
    const { rerender } = render(<TxButton label="Claim" request={request} onConfirmed={onConfirmed} />);
    expect(screen.getByRole('button')).toHaveTextContent('Waiting for confirmation');
    wait.data = { status: 'reverted', transactionHash: HASH };
    rerender(<TxButton label="Claim" request={request} onConfirmed={onConfirmed} />);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('Failed');
  });
  it('calls onConfirmed once after a status-success receipt', () => {
    const onConfirmed = vi.fn();
    write.data = HASH;
    const { rerender } = render(<TxButton label="Claim" request={request} onConfirmed={onConfirmed} />);
    wait.data = { status: 'success', transactionHash: HASH };
    act(() => rerender(<TxButton label="Claim" request={request} onConfirmed={onConfirmed} />));
    rerender(<TxButton label="Claim" request={request} onConfirmed={onConfirmed} />);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /view transaction/i })).toHaveAttribute(
      'href',
      expect.stringContaining(HASH),
    );
  });
  it('returns to idle after a user rejection', () => {
    write.error = { code: 4001 };
    const { container } = render(<TxButton label="Claim" request={request} />);
    expect(container.querySelector('.sp-tx')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByRole('button')).toHaveTextContent('Claim');
    expect(screen.getByRole('button')).toBeEnabled();
  });
  it('submits the write on click', async () => {
    render(<TxButton label="Claim" request={request} />);
    await userEvent.click(screen.getByRole('button'));
    expect(write.writeContract).toHaveBeenCalledOnce();
  });
});
