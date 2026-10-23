import { encodeFunctionData, erc20Abi } from 'viem';
import { env } from '../../../config';
import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';
import { getRec, originMicrosFor, patchRec, recForOrder } from './card-operations';

const need = () => {
  if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
};
const DEPOSITORY = '0x00000000000000000000000000000000000c0001';

export const relayFixtures: MockFixtures = {
  'POST /v1/app/card-operations/:id/relay-quote': ({ params }) => {
    need();
    if (new URLSearchParams(window.location.search).get('scenario') === 'liquidity') {
      throw new ApiError('INSUFFICIENT_LIQUIDITY', 'INSUFFICIENT_LIQUIDITY', 422);
    }
    const rec = getRec(params.id as string);
    const origin = originMicrosFor(rec.cents);
    const relayOrderId = `rel_${rec.id}_${Date.now().toString(36)}`;
    patchRec(rec.id, { relayOrderId });
    const steps = [
      ...(rec.approveAt
        ? []
        : [
            {
              id: 'approve',
              kind: 'transaction' as const,
              items: [
                {
                  to: env.addresses.usdg,
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [DEPOSITORY, origin],
                  }),
                  value: '0',
                  chainId: env.chainId,
                },
              ],
            },
          ]),
      {
        id: 'deposit',
        kind: 'transaction' as const,
        items: [{ to: DEPOSITORY, data: '0x', value: '0', chainId: env.chainId }],
      },
    ];
    return {
      relayOrderId,
      requestId: `0x${'ab'.repeat(32)}`,
      originAmountMicros: origin.toString(),
      feesUsd: '0.69',
      timeEstimateSec: 2,
      steps,
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    };
  },
  'POST /v1/app/relay-orders/:id/submitted': ({ params, body }) => {
    need();
    const rec = recForOrder(params.id as string);
    if (!rec) throw new ApiError('NOT_FOUND', 'Relay order not found', 404);
    const b = body as { step: 'approve' | 'deposit'; txHash: string };
    if (b.step === 'approve') patchRec(rec.id, { approveAt: Date.now() });
    else patchRec(rec.id, { depositAt: Date.now(), depositTx: b.txHash });
    return { status: b.step === 'approve' ? 'signing' : 'submitted' };
  },
};
