import { z } from 'zod';
import { JobKind, Lane, UnitKind } from '../enums';
import { MicrosString } from '../money';
import { Address, Bytes32, IsoTime, TxHash } from './common';
import { GpuClass } from './gpu-schema';

export const GetHealthReq = z.void();
export const GetHealthRes = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.boolean(),
  redis: z.boolean(),
  chain: z.boolean(),
});

export const GetNetworkStatsReq = z.void();
export const GetNetworkStatsRes = z.object({
  nodesOnline: z.number().int(),
  nodesByLane: z.object({ sealed: z.number().int(), open: z.number().int() }),
  jobs24h: z.number().int(),
  tokens24h: z.number().int(),
  latestEpoch: z.number().int().nullable(),
});

export const RateCardRow = z.object({
  gpuClass: GpuClass,
  lane: z.enum(Lane),
  unitKind: z.enum(UnitKind),
  providerMicrosPerUnit: MicrosString,
  buyerMicrosPerUnit: MicrosString,
});
export type RateCardRow = z.infer<typeof RateCardRow>;
export const GetRateCardReq = z.void();
export const GetRateCardRes = z.array(RateCardRow);

export const GetEpochsLatestReq = z.void();
export const GetEpochsLatestRes = z.object({
  epoch: z.number().int(),
  root: Bytes32,
  totalEarned: MicrosString,
  postedAt: IsoTime.nullable(),
  txHash: TxHash.nullable(),
  claimableAt: IsoTime.nullable(),
});

/** OpenZeppelin StandardMerkleTree.dump() shape. */
export const MerkleTreeDump = z.object({
  format: z.string(),
  tree: z.array(z.string()),
  values: z.array(z.object({ value: z.array(z.string()), treeIndex: z.number().int() })),
  leafEncoding: z.array(z.string()),
});
export const GetEpochTreeReq = z.void();
export const GetEpochTreeRes = MerkleTreeDump;

export const ReceiptView = z.object({
  jobId: z.string().uuid(),
  nodeId: z.string(),
  onchainNodeId: z.string().nullable(),
  nodeKey: Address,
  lane: z.enum(Lane),
  model: z.string(),
  usage: z.object({ p: z.number().int(), c: z.number().int(), n: z.number().int().optional() }),
  cose: z.string().describe('base64 COSE_Sign1'),
  payload: z.record(z.string(), z.unknown()),
  verified: z.boolean(),
  reason: z.string().nullable(),
  attestationRef: z.string().nullable(),
  epoch: z.number().int().nullable(),
});
export type ReceiptView = z.infer<typeof ReceiptView>;
export const GetReceiptReq = z.void();
export const GetReceiptRes = ReceiptView;

export const GetOpenapiReq = z.void();
export const GetOpenapiRes = z.record(z.string(), z.unknown());

export const GetSealedKeysReq = z.object({ model: z.string() });
export const GetSealedKeysRes = z.array(
  z.object({
    nodeId: z.string(),
    hpkePublicKey: z.string(),
    attestationRef: z.string(),
    expiresAt: IsoTime,
  }),
);

export { JobKind };
