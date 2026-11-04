import { z } from 'zod';
import { ClaimStatus, EarningKind, JobKind, JobReportReason, JobStatus, Lane, UnitKind } from '../enums';
import { MicrosString, SignedMicrosString } from '../money';
import { Address, Bytes32, IsoTime, PageQuery, Paginated, TxHash } from './common';
import { ReceiptView } from './public';

export const GetMeReq = z.void();
export const Prefs = z
  .object({
    afterClaim: z.enum(['keep', 'card', 'stock']).optional(),
    notifications: z.boolean().optional(),
    cardFinish: z.string().optional(),
  })
  .strict();
export type Prefs = z.infer<typeof Prefs>;
export const GetMeRes = z.object({
  address: Address,
  prefs: Prefs,
  isAdmin: z.boolean(),
  buyer: z.object({ id: z.string(), balanceMicros: MicrosString }).nullable(),
});

export const PatchMeReq = z.object({ prefs: Prefs });
export const PatchMeRes = z.object({ prefs: Prefs });

export const GetEarningsSummaryReq = z.void();
export const GetEarningsSummaryRes = z.object({
  totalEarnedMicros: MicrosString,
  claimedMicros: MicrosString,
  claimableMicros: MicrosString,
  pendingMicros: MicrosString,
  /** in a posted root, claimable at `claimableAt` (1 h claim delay) */
  unlockingMicros: MicrosString,
  /** not in a posted root yet; the next root is expected at `nextRootAt` */
  awaitingRootMicros: MicrosString,
  nextRootAt: IsoTime.nullable(),
  latestEpoch: z.number().int().nullable(),
  nextEpochAt: IsoTime.nullable(),
  claimableAt: IsoTime.nullable(),
  minClaimMicros: MicrosString,
  nodes: z.object({ total: z.number().int(), online: z.number().int() }),
});

export const GetEarningsSeriesReq = z.object({ range: z.enum(['7d', '30d', '90d']).default('7d') });
export const GetEarningsSeriesRes = z.object({
  buckets: z.array(
    z.object({ ts: IsoTime, jobMicros: MicrosString, floorMicros: MicrosString, slashMicros: MicrosString }),
  ),
});

export const LedgerEntry = z.object({
  id: z.string(),
  ts: IsoTime,
  nodeId: z.string(),
  jobId: z.string().nullable(),
  kind: z.enum(EarningKind),
  micros: SignedMicrosString,
  epoch: z.number().int().nullable(),
});
export const GetEarningsLedgerReq = PageQuery;
export const GetEarningsLedgerRes = Paginated(LedgerEntry);

export const GetEarningsStatementReq = z.object({ from: IsoTime.optional(), to: IsoTime.optional() });
/** text/csv body */
export const GetEarningsStatementRes = z.string();

export const GetClaimProofReq = z.void();
export const GetClaimProofRes = z.object({
  epoch: z.number().int(),
  cumulativeMicros: MicrosString,
  proof: z.array(Bytes32),
  claimedMicros: MicrosString,
  claimableMicros: MicrosString,
  contract: Address,
  abiFn: z.literal('claim'),
});

export const ClaimRow = z.object({
  id: z.string(),
  epoch: z.number().int(),
  amountMicros: MicrosString,
  txHash: TxHash.nullable(),
  blockNumber: z.number().int().nullable(),
  status: z.enum(ClaimStatus),
  createdAt: IsoTime,
});
export const GetClaimsReq = PageQuery;
export const GetClaimsRes = Paginated(ClaimRow);

export const ReceiptListItem = z.object({
  jobId: z.string(),
  model: z.string(),
  kind: z.enum(JobKind),
  lane: z.enum(Lane),
  nodeName: z.string(),
  gpu: z.string().nullable(),
  units: z.string(),
  unitKind: z.enum(UnitKind),
  providerMicros: MicrosString,
  status: z.enum(JobStatus),
  verified: z.boolean().nullable(),
  createdAt: IsoTime,
});
export const GetAppReceiptsReq = PageQuery.extend({
  lane: z.enum(Lane).optional(),
  q: z.string().optional(),
});
export const GetAppReceiptsRes = Paginated(ReceiptListItem);

export const PostAppReceiptReportReq = z.object({
  reason: z.enum(JobReportReason),
  details: z.string().trim().max(2000).optional(),
});
export const PostAppReceiptReportRes = z.object({ id: z.string(), status: z.literal('open') });

export const GetAppReceiptReq = z.void();
export const GetAppReceiptRes = ReceiptView.extend({
  /** The signed-in user paid for this job, can still report it and has not done so yet. */
  canReport: z.boolean(),
  earning: z.object({ providerMicros: MicrosString, epoch: z.number().int().nullable() }).nullable(),
});
