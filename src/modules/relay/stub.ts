import { encodeFunctionData, parseAbi, parseEventLogs, type TransactionReceipt } from 'viem';
import { cardSettings } from '../cards/settings';
import type { RelayQuote } from './client';

/** Dev-only. `RelayStubDepository` lives on the fork (app/contracts/src/dev). */
export const stubAbi = parseAbi([
  'function deposit(bytes32 requestId, address token, uint256 amount)',
  'event StubDeposit(bytes32 indexed requestId, address indexed sender, address token, uint256 amount)',
]);
const erc20Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export type ServedStep = {
  id: string;
  kind: 'transaction';
  items: { to: string; data: string; value: string; chainId: number }[];
};

export function stubAddress(): `0x${string}` {
  const addr = cardSettings.relayStubAddress;
  if (!addr) throw new Error('RELAY_STUB_ADDRESS is not configured');
  return addr.toLowerCase() as `0x${string}`;
}

/**
 * Keeps the real quote's fees/amounts but points the user's transactions at the stub depository:
 * approve(stub, amountIn) on the origin token, then stub.deposit(requestId, token, amountIn).
 */
export function rewriteForStub(quote: RelayQuote): ServedStep[] {
  const stub = stubAddress();
  const amountIn = BigInt(quote.details.currencyIn.amount);
  const chainId = cardSettings.appChainId;
  const token = (
    (quote.details.currencyIn.currency as { address?: string } | undefined)?.address ??
    cardSettings.usdgAddress
  ).toLowerCase() as `0x${string}`;
  return [
    {
      id: 'approve',
      kind: 'transaction',
      items: [
        {
          to: token,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [stub, amountIn] }),
          value: '0',
          chainId,
        },
      ],
    },
    {
      id: 'deposit',
      kind: 'transaction',
      items: [
        {
          to: stub,
          data: encodeFunctionData({
            abi: stubAbi,
            functionName: 'deposit',
            args: [quote.requestId as `0x${string}`, token, amountIn],
          }),
          value: '0',
          chainId,
        },
      ],
    },
  ];
}

/** True when the receipt holds a StubDeposit for `requestId` from `sender` of at least `minAmount`. */
export function receiptHasStubDeposit(
  receipt: TransactionReceipt,
  requestId: string,
  sender: string,
  minAmount: bigint,
): boolean {
  const logs = parseEventLogs({ abi: stubAbi, logs: receipt.logs, eventName: 'StubDeposit' });
  return logs.some(
    (l) =>
      l.address.toLowerCase() === stubAddress() &&
      l.args.requestId.toLowerCase() === requestId.toLowerCase() &&
      l.args.sender.toLowerCase() === sender.toLowerCase() &&
      l.args.amount >= minAmount,
  );
}
