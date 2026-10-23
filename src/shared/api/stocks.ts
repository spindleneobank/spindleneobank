import { z } from 'zod';
import { MicrosString } from '../money';
import { Address, ContractCall, IsoTime } from './common';

export const StockToken = z.object({
  address: Address,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  poolFee: z.number().int(),
});
export const GetStocksReq = z.void();
export const GetStocksRes = z.array(StockToken);

export const PostStocksQuoteReq = z.object({
  token: Address,
  amountInMicros: MicrosString,
  slippageBps: z.number().int().min(1).max(1000).default(50),
});
export const PostStocksQuoteRes = z.object({
  amountOut: z.string().regex(/^\d+$/).describe('token base units'),
  priceImpactBps: z.number().int(),
  feeBps: z.number().int().describe('pool fee tier in bps (excluded from priceImpactBps)'),
  minOut: z.string().regex(/^\d+$/),
  warnImpact: z.boolean(),
  approve: ContractCall.optional(),
  swap: ContractCall.extend({ functionName: z.string(), value: z.literal('0') }),
  quotedAt: IsoTime,
  expiresAt: IsoTime,
});
