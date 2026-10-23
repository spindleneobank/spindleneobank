import { env } from '../../../config';
import { ApiError } from '../../errors';
import type { MockFixtures } from '../mock';
import { readMockSession } from './auth';

const STOCKS = [
  {
    address: '0x00000000000000000000000000000000000a0001',
    symbol: 'NVDA',
    name: 'NVIDIA Stock Token',
    decimals: 18,
    poolFee: 500,
    px: 138,
  },
  {
    address: '0x00000000000000000000000000000000000a0002',
    symbol: 'TSLA',
    name: 'Tesla Stock Token',
    decimals: 18,
    poolFee: 500,
    px: 251,
  },
  {
    address: '0x00000000000000000000000000000000000a0003',
    symbol: 'AAPL',
    name: 'Apple Stock Token',
    decimals: 18,
    poolFee: 3000,
    px: 229,
  },
] as const;
const ROUTER = '0x00000000000000000000000000000000000b0001';
const scenario = () => new URLSearchParams(window.location.search).get('scenario');

export const stockFixtures: MockFixtures = {
  'GET /v1/app/stocks': ({ mode }) => {
    if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    if (mode === 'empty') return [];
    return STOCKS.map(({ px: _px, ...s }) => s);
  },
  'POST /v1/app/stocks/quote': ({ body }) => {
    if (!readMockSession()) throw new ApiError('UNAUTHENTICATED', 'Not signed in', 401);
    const b = body as { token: string; amountInMicros: string; slippageBps?: number };
    const st = STOCKS.find((s) => s.address === b.token);
    if (!st) throw new ApiError('VALIDATION', 'Unknown token', 400);
    if (scenario() === 'noliq') {
      throw new ApiError('INSUFFICIENT_LIQUIDITY', 'quote unavailable: not enough pool liquidity', 422);
    }
    const amountIn = BigInt(b.amountInMicros);
    const out = (amountIn * 10n ** BigInt(st.decimals - 6)) / BigInt(st.px);
    const impact = scenario() === 'impact' || amountIn > 5_000_000_000n ? 340 : 12;
    const slip = BigInt(b.slippageBps ?? 50);
    const minOut = (out * (10_000n - slip)) / 10_000n;
    const now = Date.now();
    return {
      amountOut: out.toString(),
      priceImpactBps: impact,
      feeBps: st.poolFee / 100,
      minOut: minOut.toString(),
      warnImpact: impact > 200,
      approve: { to: env.addresses.usdg, functionName: 'approve', args: [ROUTER, amountIn.toString()] },
      swap: {
        to: ROUTER,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: env.addresses.usdg,
            tokenOut: st.address,
            fee: st.poolFee,
            recipient: readMockSession()?.address,
            amountIn: amountIn.toString(),
            amountOutMinimum: minOut.toString(),
            sqrtPriceLimitX96: '0',
          },
        ],
        value: '0',
      },
      quotedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    };
  },
};
