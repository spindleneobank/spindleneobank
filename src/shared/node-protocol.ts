import { z } from 'zod';
import { canonicalJson, sha256Hex } from './canonical';
import { Engine, JobKind, Lane } from './enums';

/** Node WS protocol (docs/plan/node-protocol.md). Every message is JSON text with `v: 1`. */

export const PROTOCOL_VERSION = 1 as const;

export const CLOSE_CODES = {
  PROTOCOL_ERROR: 4000,
  UPGRADE_REQUIRED: 4001,
  AUTH_FAILED: 4003,
  SUSPENDED: 4004,
  REPLACED: 4008,
} as const;
export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

const v = z.literal(PROTOCOL_VERSION);
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);

export const GpuReport = z.object({
  name: z.string(),
  vramMb: z.number().int().nonnegative(),
  driver: z.string(),
  uuid: z.string(),
  cc: z.boolean(),
});
export type GpuReport = z.infer<typeof GpuReport>;

export const HardwareReport = z.object({
  gpus: z.array(GpuReport),
  cpu: z.string(),
  ramMb: z.number().int().nonnegative(),
});
export type HardwareReport = z.infer<typeof HardwareReport>;

export const NodeCapability = z.enum(['chat', 'embeddings', 'images']);
export type NodeCapability = z.infer<typeof NodeCapability>;

export const ModelDigest = z.object({ id: z.string(), digest: z.string(), sizeMb: z.number().nonnegative() });

/** Sealed lane (S1): attestation bundle in hello / attest.refresh. */
export const AttestationBundle = z.object({
  tdxQuote: z.string(),
  eventLog: z.unknown(),
  nvidiaEvidence: z.unknown(),
  hpkePublicKey: z.string(),
  measurements: z.record(z.string(), z.unknown()),
});
export type AttestationBundle = z.infer<typeof AttestationBundle>;

/** EIP-712 binding as sent in welcome / binding.request. `deadline` is unix seconds. */
export const BindingRequest = z.object({
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.number().int(),
    verifyingContract: Address,
  }),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.literal('NodeBinding').optional(),
  message: z.object({
    owner: Address,
    nodeKey: Address,
    gpuClass: z.number().int().min(0).max(4),
    ccCapable: z.boolean(),
    deadline: z.number().int().positive(),
  }),
});
export type BindingRequest = z.infer<typeof BindingRequest>;

export const EnsureModel = z.object({
  id: z.string(),
  engineModel: z.string(),
  sizeMb: z.number().nonnegative(),
});
export type EnsureModel = z.infer<typeof EnsureModel>;

// ---- server -> node ----------------------------------------------------------------------------

export const ChallengeMsg = z.object({
  v,
  type: z.literal('challenge'),
  nonce: z.string(),
  serverTime: z.number(),
});

export const PairingMsg = z.object({
  v,
  type: z.literal('pairing'),
  code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  url: z.string(),
  expiresAt: z.string(),
});

export const WelcomeMsg = z.object({
  v,
  type: z.literal('welcome'),
  nodeId: z.string(),
  owner: Address,
  name: z.string(),
  gpuClass: z.number().int().min(0).max(4),
  lane: z.enum(Lane),
  ccCapable: z.boolean(),
  registered: z.boolean(),
  eligible: z.boolean(),
  staked: z.boolean(),
  binding: BindingRequest,
  catalog: z.array(EnsureModel),
  minAgentVersion: z.string(),
});

export const EligibilityMsg = z.object({
  v,
  type: z.literal('eligibility'),
  registered: z.boolean(),
  eligible: z.boolean(),
  staked: z.boolean().optional(),
  onchainId: z.string().nullable(),
});

export const BindingRequestMsg = z.object({
  v,
  type: z.literal('binding.request'),
  binding: BindingRequest,
});

export const UpgradeRequiredMsg = z.object({
  v,
  type: z.literal('upgrade_required'),
  minAgentVersion: z.string(),
});

export const PingMsg = z.object({ v, type: z.literal('ping') });

export const ModelsEnsureMsg = z.object({
  v,
  type: z.literal('models.ensure'),
  models: z.array(EnsureModel),
});

export const SealedPayload = z.object({ enc: z.string(), ciphertext: z.string() });

export const JobStartMsg = z.object({
  v,
  type: z.literal('job.start'),
  jobId: z.string(),
  kind: z.enum(JobKind),
  model: z.string(),
  engineModel: z.string(),
  lane: z.enum(Lane),
  request: z.record(z.string(), z.unknown()),
  maxTokens: z.number().int().nonnegative(),
  deadlineMs: z.number().int().positive(),
  sealed: SealedPayload.optional(),
});

export const JobCancelMsg = z.object({ v, type: z.literal('job.cancel'), jobId: z.string() });

export const ProbeStartMsg = z.object({
  v,
  type: z.literal('probe.start'),
  probeId: z.string(),
  kind: z.enum(['hardware', 'bench']),
  params: z.object({ model: z.string(), prompt: z.string(), maxTokens: z.number().int().positive() }),
});

// ---- node -> server ----------------------------------------------------------------------------

export const HelloBody = z.object({
  v,
  type: z.literal('hello'),
  nodeKey: Address,
  publicKey: Hex,
  agentVersion: z.string(),
  engine: z.enum(Engine),
  engineVersion: z.string(),
  os: z.string(),
  arch: z.string(),
  hardware: HardwareReport,
  models: z.array(ModelDigest),
  capabilities: z.array(NodeCapability),
  capacity: z.number().int().positive(),
  enrollToken: z.string().optional(),
  attestation: AttestationBundle.optional(),
});
export type HelloBody = z.infer<typeof HelloBody>;

export const HelloMsg = HelloBody.extend({ sig: Hex });

export const BindingMsg = z.object({
  v,
  type: z.literal('binding'),
  sig: Hex,
  deadline: z.number().int().positive(),
});

export const StatusMsg = z.object({
  v,
  type: z.literal('status'),
  state: z.enum(['idle', 'busy', 'loading']),
  gpus: z.array(
    z.object({
      util: z.number(),
      memUsedMb: z.number(),
      tempC: z.number().optional(),
      powerW: z.number().optional(),
    }),
  ),
  loadedModels: z.array(z.string()),
  queue: z.number().int().nonnegative(),
});

export const PongMsg = z.object({ v, type: z.literal('pong') });

export const ModelsProgressMsg = z.object({
  v,
  type: z.literal('models.progress'),
  id: z.string(),
  pct: z.number().min(0).max(100),
});

export const ModelsReadyMsg = z.object({
  v,
  type: z.literal('models.ready'),
  models: z.array(z.object({ id: z.string(), digest: z.string() })),
});

export const JobAcceptedMsg = z.object({ v, type: z.literal('job.accepted'), jobId: z.string() });

export const JobChunkMsg = z.object({
  v,
  type: z.literal('job.chunk'),
  jobId: z.string(),
  seq: z.number().int().nonnegative(),
  delta: z.object({ content: z.string().optional(), reasoning: z.string().optional() }),
  sealed: z.boolean().optional(),
});

export const JobUsage = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  images: z.number().int().nonnegative().optional(),
});
export type JobUsage = z.infer<typeof JobUsage>;

export const JobDoneMsg = z.object({
  v,
  type: z.literal('job.done'),
  jobId: z.string(),
  output: z.unknown(),
  usage: JobUsage,
  /** base64 COSE_Sign1 */
  receipt: z.string(),
  sealed: z.boolean().optional(),
});

export const JOB_ERROR_CODES = ['MODEL_NOT_READY', 'ENGINE_ERROR', 'TIMEOUT', 'OOM', 'BUSY'] as const;
export const JobErrorMsg = z.object({
  v,
  type: z.literal('job.error'),
  jobId: z.string(),
  code: z.enum(JOB_ERROR_CODES),
  message: z.string(),
});

export const ProbeResultMsg = z.object({
  v,
  type: z.literal('probe.result'),
  probeId: z.string(),
  hardware: HardwareReport.optional(),
  bench: z
    .object({ tokPerSec: z.number(), ttftMs: z.number(), model: z.string(), digest: z.string() })
    .optional(),
});

export const AttestRefreshMsg = z.object({
  v,
  type: z.literal('attest.refresh'),
  attestation: AttestationBundle,
});

// ---- unions ------------------------------------------------------------------------------------

export const ServerToNode = z.discriminatedUnion('type', [
  ChallengeMsg,
  PairingMsg,
  WelcomeMsg,
  EligibilityMsg,
  BindingRequestMsg,
  UpgradeRequiredMsg,
  PingMsg,
  ModelsEnsureMsg,
  JobStartMsg,
  JobCancelMsg,
  ProbeStartMsg,
]);
export type ServerToNode = z.infer<typeof ServerToNode>;

export const NodeToServer = z.discriminatedUnion('type', [
  HelloMsg,
  BindingMsg,
  StatusMsg,
  PongMsg,
  ModelsProgressMsg,
  ModelsReadyMsg,
  JobAcceptedMsg,
  JobChunkMsg,
  JobDoneMsg,
  JobErrorMsg,
  ProbeResultMsg,
  AttestRefreshMsg,
]);
export type NodeToServer = z.infer<typeof NodeToServer>;

export type ChallengeMsg = z.infer<typeof ChallengeMsg>;
export type PairingMsg = z.infer<typeof PairingMsg>;
export type WelcomeMsg = z.infer<typeof WelcomeMsg>;
export type EligibilityMsg = z.infer<typeof EligibilityMsg>;
export type BindingRequestMsg = z.infer<typeof BindingRequestMsg>;
export type UpgradeRequiredMsg = z.infer<typeof UpgradeRequiredMsg>;
export type PingMsg = z.infer<typeof PingMsg>;
export type ModelsEnsureMsg = z.infer<typeof ModelsEnsureMsg>;
export type JobStartMsg = z.infer<typeof JobStartMsg>;
export type JobCancelMsg = z.infer<typeof JobCancelMsg>;
export type ProbeStartMsg = z.infer<typeof ProbeStartMsg>;
export type HelloMsg = z.infer<typeof HelloMsg>;
export type BindingMsg = z.infer<typeof BindingMsg>;
export type StatusMsg = z.infer<typeof StatusMsg>;
export type PongMsg = z.infer<typeof PongMsg>;
export type ModelsProgressMsg = z.infer<typeof ModelsProgressMsg>;
export type ModelsReadyMsg = z.infer<typeof ModelsReadyMsg>;
export type JobAcceptedMsg = z.infer<typeof JobAcceptedMsg>;
export type JobChunkMsg = z.infer<typeof JobChunkMsg>;
export type JobDoneMsg = z.infer<typeof JobDoneMsg>;
export type JobErrorMsg = z.infer<typeof JobErrorMsg>;
export type ProbeResultMsg = z.infer<typeof ProbeResultMsg>;
export type AttestRefreshMsg = z.infer<typeof AttestRefreshMsg>;

/**
 * The string the node signs with personal_sign (and the server verifies with viem `verifyMessage`):
 * `spindle-node-auth:${nonce}:${sha256hex(canonicalJson(helloWithoutSig))}`.
 */
export function helloSigningMessage(nonce: string, helloWithoutSig: Record<string, unknown>): string {
  return `spindle-node-auth:${nonce}:${sha256Hex(canonicalJson(helloWithoutSig))}`;
}
