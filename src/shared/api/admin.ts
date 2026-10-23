import { z } from 'zod';
import { Lane, SlashStatus, UnitKind } from '../enums';
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
] as const;

export const GetAdminOverviewReq = z.void();
export const GetAdminOverviewRes = z.object({
  balances: z.object({
    treasuryUsdgMicros: MicrosString,
    keeperEthWei: z.string(),
    keeperUsdgMicros: MicrosString,
    claimsPoolUsdgMicros: MicrosString,
    claimsOwedMicros: MicrosString,
  }),
  killMetrics: z.object({
    liveNodes: z.number().int(),
    sealedNodes: z.number().int(),
    buyerSpend30dMicros: MicrosString,
    cardStockShareBps: z.number().int(),
    floorShareBps: z.number().int(),
  }),
  queues: z.record(
    z.string(),
    z.object({ waiting: z.number().int(), active: z.number().int(), failed: z.number().int() }),
  ),
  lastEpoch: z.number().int().nullable(),
});

export const GetAdminRateCardReq = z.void();
export const GetAdminRateCardRes = z.object({ day: z.string(), rows: z.array(RateCardRow) });
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
export const PostAdminNodeUnsuspendReq = z.void();
export const PostAdminNodeUnsuspendRes = PostAdminNodeSuspendRes;

export const GetAdminFloorReq = z.void();
export const GetAdminFloorRes = z.object({
  budgetMicros: MicrosString,
  decayBps: z.number().int(),
  perEpoch: z.array(z.object({ epoch: z.number().int(), paidMicros: MicrosString, nodes: z.number().int() })),
});

export const GetAdminSlashEvidenceReq = z.void();
export const GetAdminSlashEvidenceRes = z.record(z.string(), z.unknown());

export const PostAdminSlashSubmittedReq = z.object({ txHash: TxHash });
export const PostAdminSlashSubmittedRes = z.object({ status: z.enum(SlashStatus) });
export const PostAdminSlashDismissReq = z.object({ reason: z.string().min(1) });
export const PostAdminSlashDismissRes = z.object({ status: z.literal('dismissed') });

export const PostAdminJobRunReq = z.void();
export const PostAdminJobRunRes = z.object({ queued: z.literal(true), job: z.enum(ADMIN_JOB_NAMES) });

export { GpuClass };
