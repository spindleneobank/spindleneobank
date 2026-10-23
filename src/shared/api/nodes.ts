import { z } from 'zod';
import { Engine, Lane, NodeStatus } from '../enums';
import { MicrosString } from '../money';
import { Address, ContractCall, IsoTime } from './common';
import { GpuClass } from './gpu-schema';

export const NodeOs = z.enum(['linux', 'windows', 'macos']);

export const PostNodesEnrollReq = z.object({
  engine: z.enum(Engine),
  os: NodeOs,
  name: z.string().min(1).max(64).optional(),
});
export const PostNodesEnrollRes = z.object({
  enrollmentId: z.string(),
  token: z.string(),
  expiresAt: IsoTime,
  commands: z.object({ docker: z.string(), installer: z.string() }),
});

export const PairingCode = z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

export const NodeView = z.object({
  id: z.string(),
  name: z.string(),
  onchainId: z.string().nullable(),
  nodeKey: Address,
  status: z.enum(NodeStatus),
  engine: z.enum(Engine),
  gpuModel: z.string().nullable(),
  gpuCount: z.number().int().nullable(),
  vramGb: z.number().int().nullable(),
  gpuClass: GpuClass,
  lane: z.enum(Lane),
  ccCapable: z.boolean(),
  registered: z.boolean(),
  stake: z.object({
    active: z.string(),
    pending: z.string(),
    unlockAt: IsoTime.nullable(),
    min: z.string(),
  }),
  reputation: z.number().int(),
  lastSeenAt: IsoTime.nullable(),
  lastProbe: z.unknown().nullable(),
  lastCanary: z.unknown().nullable(),
  earnings24hMicros: MicrosString,
  models: z.array(z.unknown()),
  isHouse: z.boolean(),
});
export type NodeView = z.infer<typeof NodeView>;

export const PostNodesPairReq = z.object({ code: PairingCode });
export const PostNodesPairRes = z.object({ node: NodeView });

export const GetNodesReq = z.void();
export const GetNodesRes = z.array(NodeView);

export const GetNodeReq = z.void();
export const GetNodeRes = NodeView.extend({
  probes: z.array(z.unknown()),
  canaries: z.array(z.unknown()),
  jobs: z.array(z.unknown()),
});

export const PatchNodeReq = z.object({ name: z.string().min(1).max(64) });
export const PatchNodeRes = NodeView;

export const GetNodeRegisterCallReq = z.void();
export const GetNodeRegisterCallRes = z.object({
  to: Address,
  functionName: z.literal('registerNode'),
  /** [nodeKey, gpuClass, ccCapable, attestationRef, deadline, nodeSig] */
  args: z.tuple([Address, z.number().int(), z.boolean(), z.string(), z.string(), z.string()]),
});

export const GetNodeStakeCallReq = z.object({ amount: MicrosString.describe('SPDL wei') });
export const GetNodeStakeCallRes = z.object({
  approve: ContractCall.optional(),
  stake: ContractCall,
});

export const GetStakingParamsReq = z.void();
export const GetStakingParamsRes = z.object({
  token: Address,
  minStakeByClass: z.record(z.string(), z.string()),
  unstakeDelay: z.number().int(),
});
