import { canonicalJson, sha256Hex } from '@spindle/shared/canonical-json';
import {
  type ReceiptPayload,
  encodeReceipt,
  outputDigest,
  receiptToBase64,
  signReceipt,
} from '@spindle/shared/receipt';
import type { JobStartMsg } from '@spindle/shared/node-protocol';
import type { NodeKey } from './key';

export type JobOutput = string | number[][] | Uint8Array[];

export interface ReceiptUsage {
  promptTokens: number;
  completionTokens: number;
  images?: number;
}

export interface ReceiptContext {
  modelDigest: string;
  agentVersion: string;
}

export function inputDigest(request: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(request));
}

export function buildReceiptPayload(
  job: Pick<JobStartMsg, 'jobId' | 'model' | 'kind' | 'lane' | 'request'>,
  output: JobOutput,
  usage: ReceiptUsage,
  timings: { startedAt: number; finishedAt: number },
  key: Pick<NodeKey, 'address'>,
  ctx: ReceiptContext,
): ReceiptPayload {
  return {
    v: 1,
    jobId: job.jobId,
    nodeKey: key.address,
    model: job.model,
    modelDigest: ctx.modelDigest,
    kind: job.kind,
    lane: job.lane,
    usage: {
      p: usage.promptTokens,
      c: usage.completionTokens,
      ...(usage.images !== undefined ? { n: usage.images } : {}),
    },
    inputDigest: inputDigest(job.request),
    outputDigest: outputDigest(job.kind, output),
    startedAt: timings.startedAt,
    finishedAt: timings.finishedAt,
    agentVersion: ctx.agentVersion,
  };
}

/** Builds, signs and base64-encodes a COSE_Sign1 receipt. Returns the base64 string. */
export function buildReceipt(
  job: Pick<JobStartMsg, 'jobId' | 'model' | 'kind' | 'lane' | 'request'>,
  output: JobOutput,
  usage: ReceiptUsage,
  timings: { startedAt: number; finishedAt: number },
  key: Pick<NodeKey, 'address' | 'privateKey'>,
  ctx: ReceiptContext,
): string {
  const payload = buildReceiptPayload(job, output, usage, timings, key, ctx);
  encodeReceipt(payload); // validate early
  return receiptToBase64(signReceipt(payload, key.privateKey));
}
