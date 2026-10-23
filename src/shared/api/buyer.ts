import { z } from 'zod';
import { BuyerLedgerKind, Lane } from '../enums';
import { MicrosString, SignedMicrosString } from '../money';
import { ContractCall, IsoTime, PageQuery, Paginated, TxHash } from './common';

export const GetBuyerReq = z.void();
export const GetBuyerRes = z.object({
  address: z.string(),
  balanceMicros: MicrosString,
  reservedMicros: MicrosString,
  x402: z.object({
    enabled: z.boolean(),
    minSurchargeMicros: MicrosString,
    currentSurchargeMicros: MicrosString,
  }),
});

export const BuyerLedgerEntry = z.object({
  id: z.string(),
  kind: z.enum(BuyerLedgerKind),
  micros: SignedMicrosString,
  jobId: z.string().nullable(),
  txHash: TxHash.nullable(),
  createdAt: IsoTime,
});
export const GetBuyerLedgerReq = PageQuery;
export const GetBuyerLedgerRes = Paginated(BuyerLedgerEntry);

export const GetBuyerUsageReq = z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') });
export const GetBuyerUsageRes = z.object({
  byModel: z.array(
    z.object({
      model: z.string(),
      lane: z.enum(Lane),
      jobs: z.number().int(),
      units: z.string(),
      spentMicros: MicrosString,
    }),
  ),
  series: z.array(z.object({ ts: IsoTime, spentMicros: MicrosString, jobs: z.number().int() })),
});

export const GetBuyerDepositCallReq = z.object({ amountMicros: MicrosString });
export const GetBuyerDepositCallRes = z.object({
  approve: ContractCall.optional(),
  deposit: ContractCall.extend({ functionName: z.literal('deposit') }),
});

export const ApiKeyView = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  createdAt: IsoTime,
  lastUsedAt: IsoTime.nullable(),
  revokedAt: IsoTime.nullable(),
});
export const GetApiKeysReq = z.void();
export const GetApiKeysRes = z.array(ApiKeyView);

export const PostApiKeysReq = z.object({ name: z.string().min(1).max(64) });
/** `key` (sk-spdl-...) is shown once; only its sha256 is stored. */
export const PostApiKeysRes = z.object({ id: z.string(), key: z.string() });

export const DeleteApiKeyReq = z.void();
export const DeleteApiKeyRes = z.void();
