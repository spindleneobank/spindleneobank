import { z } from 'zod';
import { JobReportReason, JobReportStatus, Lane, SlashStatus, UnitKind } from '../enums';
import { MicrosString } from '../money';
import { Address, Hex, IsoTime, TxHash } from './common';
import { GpuClass } from './gpu-schema';
import { RateCardRow } from './public';

export const ADMIN_JOB_NAMES = [
  'epoch-build',
  'post-root',
  'x402-settle',
  'indexer',
  'canary-dispatch',
  'probe-dispatch',
  'cards-reconcile',
  'epoch-run',
  'floor-apply',
  'x402-guard',
  'gas-monitor',
  'rates-rollover',
] as const;

export const GetAdminOverviewReq = z.void();
const Counts = z.object({
  waiting: z.number().int(),
  active: z.number().int(),
  failed: z.number().int(),
  delayed: z.number().int().optional(),
});
/** Chain/infra reads fail soft: a field is null and `errors` says why. */
export const GetAdminOverviewRes = z.object({
  generatedAt: IsoTime.optional(),
  balances: z.object({
    treasuryUsdgMicros: MicrosString.nullable(),
    keeperEthWei: z.string().nullable(),
    keeperUsdgMicros: MicrosString.nullable(),
    claimsPoolUsdgMicros: MicrosString.nullable(),
    claimsOwedMicros: MicrosString.nullable(),
  }),
  solvency: z
    .object({
      claimedMicros: MicrosString,
      earnedIncludingUnpostedMicros: MicrosString,
      owedIncludingPendingMicros: MicrosString,
      headroomMicros: z.string(),
      topUpNeededMicros: MicrosString,
      treasuryCanCover: z.boolean().nullable(),
      claimsAddress: Address.nullable(),
      ok: z.boolean(),
    })
    .nullable()
    .optional(),
  keeper: z
    .object({
      address: Address,
      level: z.enum(['ok', 'low', 'critical']),
      balanceWei: z.string(),
      checkedAt: IsoTime,
    })
    .nullable()
    .optional(),
  killMetrics: z
    .object({
      liveNodes: z.number().int(),
      sealedNodes: z.number().int(),
      buyerSpend30dMicros: MicrosString,
      cardStockShareBps: z.number().int().nullable(),
      cardStockNote: z.string().optional(),
      floorShareBps: z.number().int(),
      providerPayouts30dMicros: MicrosString.optional(),
      floorPayouts30dMicros: MicrosString.optional(),
    })
    .nullable(),
  killCriteria: z
    .array(
      z.object({
        id: z.string(),
        day: z.number().int(),
        label: z.string(),
        value: z.string().nullable(),
        threshold: z.string(),
        due: z.boolean(),
        met: z.boolean().nullable(),
      }),
    )
    .nullable()
    .optional(),
  queues: z.record(z.string(), Counts).nullable(),
  lastEpoch: z.number().int().nullable(),
  lastEpochDetail: z.unknown().optional(),
  alerts: z.object({ epoch: z.unknown().nullable(), floor: z.unknown().nullable() }).optional(),
  x402: z.unknown().optional(),
  cards: z.object({ reviewOperations: z.number().int().nullable() }).optional(),
  floor: z.unknown().optional(),
  errors: z.array(z.string()).optional(),
});

export const GetAdminRateCardReq = z.void();
export const GetAdminRateCardRes = z.object({
  day: z.string(),
  rows: z.array(RateCardRow),
  today: z.object({ day: z.string(), frozen: z.boolean(), rows: z.array(RateCardRow) }).optional(),
});
export const PutAdminRateCardReq = z.object({ rows: z.array(RateCardRow).min(1) });
export const PutAdminRateCardRes = GetAdminRateCardRes;

export const AdminModel = z.object({ id: z.string(), enabled: z.boolean() });
export const GetAdminModelsReq = z.void();
export const GetAdminModelsRes = z.array(
  AdminModel.extend({
    family: z.string(),
    kind: z.string(),
    lanes: z.array(z.enum(Lane)),
    unitKind: z.enum(UnitKind),
  }),
);
export const PutAdminModelsReq = z.object({ models: z.array(AdminModel) });
export const PutAdminModelsRes = GetAdminModelsRes;

export const AdminStockToken = z.object({
  address: Address,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  poolFee: z.number().int(),
  poolAddress: Address,
  enabled: z.boolean(),
  verifiedAt: IsoTime.nullable(),
});
export const GetAdminStockTokensReq = z.void();
export const GetAdminStockTokensRes = z.array(AdminStockToken);
/** Verifies symbol/decimals/pool on-chain before storing. */
export const PutAdminStockTokensReq = z.object({
  tokens: z.array(AdminStockToken.pick({ address: true, poolFee: true, enabled: true })),
});
export const PutAdminStockTokensRes = GetAdminStockTokensRes;

export const SlashCase = z.object({
  id: z.string(),
  nodeId: z.string(),
  onchainNodeId: z.string().nullable(),
  reason: z.string(),
  evidence: z.unknown(),
  evidenceHash: Hex,
  proposedBps: z.number().int().min(0).max(10_000),
  status: z.enum(SlashStatus),
  txHash: TxHash.nullable(),
  createdAt: IsoTime,
  safeTx: z.object({ to: Address, data: Hex }).nullable(),
});
export const GetAdminSlashCasesReq = z.void();
export const GetAdminSlashCasesRes = z.array(SlashCase);

export const PostAdminNodeSuspendReq = z.object({ reason: z.string().optional() });
export const PostAdminNodeSuspendRes = z.object({ ok: z.literal(true) });
export const PostAdminNodeBanReq = z.object({ reason: z.string().min(1).max(500) });
export const PostAdminNodeBanRes = z.object({
  /** Earnings stopped from being paid. */
  withheldMicros: MicrosString,
  /** Unposted epochs retired to take the node's earnings back out. */
  retiredEpochs: z.array(z.number().int()),
  /** Posted roots still inside the veto window that pay this node: veto them from the guardian Safe, then ban again. */
  vetoableEpochs: z.array(z.number().int()),
  /** A root being posted right now: check it, and ban again if it is vetoed. */
  postingEpochs: z.array(z.number().int()),
});
export const GetAdminJobReportsReq = z.object({ status: z.enum(JobReportStatus).default('open') });
export const JobReportCase = z.object({
  id: z.string(),
  status: z.enum(JobReportStatus),
  reason: z.enum(JobReportReason),
  details: z.string().nullable(),
  reporter: Address,
  createdAt: IsoTime,
  resolution: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  /** All reports against this node that are still open. */
  openReportsOnNode: z.number().int(),
  node: z.object({
    id: z.string(),
    name: z.string().nullable(),
    owner: Address,
    status: z.string(),
    gpuModel: z.string().nullable(),
    stakeSpdl: z.string(),
  }),
  job: z.object({
    id: z.string(),
    model: z.string(),
    kind: z.string(),
    lane: z.string().nullable(),
    units: z.string(),
    chargeMicros: MicrosString,
    createdAt: IsoTime,
  }),
  receipt: z
    .object({ verified: z.boolean(), reason: z.string().nullable(), cose: z.string(), payload: z.unknown() })
    .nullable(),
});
export const GetAdminJobReportsRes = z.array(JobReportCase);
export const PostAdminJobReportResolveReq = z.object({ resolution: z.string().min(1).max(500) });
export const PostAdminJobReportDismissRes = z.object({ status: z.literal('dismissed') });
export const PostAdminJobReportUpholdRes = PostAdminNodeBanRes.extend({ status: z.literal('upheld') });

export const PostAdminNodeUnsuspendReq = z.void();
export const PostAdminNodeUnsuspendRes = PostAdminNodeSuspendRes;

export const GetAdminFloorReq = z.void();
export const GetAdminFloorRes = z.object({
  enabled: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  day: z.number().int().nullable().optional(),
  days: z.number().int().optional(),
  /** Current budget (base budget x decay) per epoch. */
  budgetMicros: MicrosString,
  baseBudgetMicros: MicrosString.optional(),
  nodeCapMicros: MicrosString.optional(),
  decayBps: z.number().int(),
  endsAt: IsoTime.nullable().optional(),
  perEpoch: z.array(z.object({ epoch: z.number().int(), paidMicros: MicrosString, nodes: z.number().int() })),
  alert: z.unknown().optional(),
});

export const GetAdminSlashEvidenceReq = z.void();
export const GetAdminSlashEvidenceRes = z.record(z.string(), z.unknown());

export const PostAdminSlashSubmittedReq = z.object({ txHash: TxHash });
export const PostAdminSlashSubmittedRes = z.object({ status: z.enum(SlashStatus) });
export const PostAdminSlashDismissReq = z.object({ reason: z.string().min(1) });
export const PostAdminSlashDismissRes = z.object({ status: z.literal('dismissed') });

export const PostAdminJobRunReq = z.void();
export const PostAdminJobRunRes = z.object({
  queued: z.literal(true),
  job: z.enum(ADMIN_JOB_NAMES),
  /** 'queue': enqueued for the worker; 'inline': ran in the API process (result included). */
  mode: z.enum(['queue', 'inline']).optional(),
  queue: z.string().optional(),
  jobId: z.string().nullable().optional(),
  result: z.unknown().optional(),
});

export { GpuClass };
