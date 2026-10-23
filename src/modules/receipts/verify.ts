import type { GatewayView } from '../../shared/contracts/jobs';
import type { JobKind, Lane } from '../../shared/enums';
import {
  decodeReceipt,
  outputDigest,
  type ReceiptPayload,
  receiptFromBase64,
  verifyReceipt,
} from '../../shared/receipt';
import { verifyReceiptAttestation } from '../attest/verify';

/** Stable reason codes stored in `receipts.reason`. */
export const RECEIPT_REASONS = [
  'BAD_SIGNATURE',
  'FIELD_MISMATCH',
  'INPUT_DIGEST',
  'OUTPUT_DIGEST',
  'TOKEN_MISMATCH',
  'NO_ATTESTATION',
] as const;
export type ReceiptReason = (typeof RECEIPT_REASONS)[number];

/** The job row plus the serving node's identity, as the verifier needs them. */
export interface VerifyJob {
  id: string;
  model: string;
  kind: JobKind;
  lane: Lane;
  nodeKey: string;
  nodePubkey: string;
}

export interface VerifyResult {
  verified: boolean;
  reason: ReceiptReason | null;
  /** Gateway recount used for the check: chat completion tokens, embeddings prompt tokens, image count. */
  recountTokens: number | null;
  /** Decoded payload when the receipt parsed (even when verification failed later). */
  payload: ReceiptPayload | null;
  attestationRef: string | null;
}

export type AttestationResult = { ok: true; ref: string } | { ok: false; reason: string };

/**
 * Sealed-lane attestation check (S1: `attest.verifyReceiptAttestation`).
 */
export const verifyDeps: {
  attestation: (
    job: VerifyJob,
    payload: ReceiptPayload,
    view: GatewayView,
  ) => AttestationResult | Promise<AttestationResult>;
} = {
  attestation: verifyReceiptAttestation,
};

/** Allowed difference between the node's count and the gateway's recount: max(3, 2%). */
export function tokenTolerance(gatewayCount: number): number {
  return Math.max(3, Math.ceil(gatewayCount * 0.02));
}
export const withinTolerance = (node: number, gateway: number): boolean =>
  Math.abs(node - gateway) <= tokenTolerance(gateway);

const fail = (
  reason: ReceiptReason,
  payload: ReceiptPayload | null,
  recountTokens: number | null,
): VerifyResult => ({ verified: false, reason, recountTokens, payload, attestationRef: null });

export function viewOutputDigest(kind: JobKind, view: GatewayView): string | null {
  try {
    if (kind === 'chat') return view.outputText === undefined ? null : outputDigest('chat', view.outputText);
    if (kind === 'embeddings') return view.embeddings ? outputDigest('embeddings', view.embeddings) : null;
    return view.images ? outputDigest('images', view.images) : null;
  } catch {
    return null;
  }
}

export function recountTokensOf(kind: JobKind, view: GatewayView): number | null {
  if (kind === 'images') return view.images ? view.images.length : null;
  if (!view.recount) return null;
  return kind === 'chat' ? view.recount.completionTokens : view.recount.promptTokens;
}

/**
 * Checks a node receipt against the gateway's own view of the job, in node-protocol order:
 * signature, fields, input digest, output digest, token recount, sealed attestation.
 * First failure wins. Pure apart from the sealed attestation lookup.
 */
export async function verifyJobReceipt(
  job: VerifyJob,
  receiptB64: string,
  view: GatewayView,
): Promise<VerifyResult> {
  const recount = recountTokensOf(job.kind, view);
  let cose: Uint8Array;
  let payload: ReceiptPayload;
  try {
    cose = receiptFromBase64(receiptB64);
    payload = decodeReceipt(cose).payload;
  } catch {
    return fail('BAD_SIGNATURE', null, recount);
  }
  // 1. signature (kid must also match the stored key)
  if (!verifyReceipt(cose, job.nodePubkey)) return fail('BAD_SIGNATURE', payload, recount);
  // 2. fields
  if (
    payload.jobId !== job.id ||
    payload.nodeKey.toLowerCase() !== job.nodeKey.toLowerCase() ||
    payload.model !== job.model ||
    payload.kind !== job.kind ||
    payload.lane !== job.lane
  ) {
    return fail('FIELD_MISMATCH', payload, recount);
  }
  // 3. input digest
  if (payload.inputDigest !== view.inputDigest) return fail('INPUT_DIGEST', payload, recount);
  // 4. output digest (the sealed gateway relays ciphertext it cannot hash)
  if (!(job.lane === 'sealed' && viewOutputDigest(job.kind, view) === null)) {
    if (payload.outputDigest !== viewOutputDigest(job.kind, view))
      return fail('OUTPUT_DIGEST', payload, recount);
  }
  // 5. recount (skipped in the sealed lane and when only the chars/3 estimate is available)
  if (job.kind === 'images') {
    if ((payload.usage.n ?? 0) !== (view.images?.length ?? 0))
      return fail('TOKEN_MISMATCH', payload, recount);
  } else if (view.recount && !view.recountEstimated && job.lane !== 'sealed') {
    const okPrompt = withinTolerance(payload.usage.p, view.recount.promptTokens);
    const okCompletion =
      job.kind === 'embeddings' || withinTolerance(payload.usage.c, view.recount.completionTokens);
    if (!okPrompt || !okCompletion) return fail('TOKEN_MISMATCH', payload, recount);
  }
  // 6. sealed lane attestation
  let attestationRef: string | null = null;
  if (job.lane === 'sealed') {
    const att = await verifyDeps.attestation(job, payload, view);
    if (!att.ok) return fail('NO_ATTESTATION', payload, recount);
    attestationRef = att.ref;
  }
  return { verified: true, reason: null, recountTokens: recount, payload, attestationRef };
}
