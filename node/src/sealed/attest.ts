import { canonicalJson, sha256Hex } from '@spindle/shared/canonical-json';
import { expectedReportData, replayRtmr3, sha256 } from '@spindle/shared/dstack';
import type { AttestationBundle } from '@spindle/shared/node-protocol';
import { type DstackFetch, dstackGetQuote, parseDstackQuote } from './dstack';
import { bunTools, collectNvidiaEvidence, type GpuTools } from './nvidia';

/** The hashes a sealed-lane receipt echoes (`ReceiptPayload.attestation`). */
export interface ReceiptAttestation {
  quoteHash: string;
  rtmr3: string;
  gpuEvidenceHash: string;
  hpkeKeyHash: string;
}

export interface Collected {
  bundle: AttestationBundle;
  receipt: ReceiptAttestation;
}

export interface CollectDeps {
  quote: DstackFetch;
  gpu: GpuTools;
  randomNonce: () => string;
}

export const defaultCollectDeps: CollectDeps = {
  quote: dstackGetQuote,
  gpu: bunTools,
  randomNonce: () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'),
};

/**
 * Builds a fresh attestation bundle inside the CVM:
 *   nonce       = 32 random bytes (also the NVIDIA nonce, so GPU evidence and TDX quote share one freshness token)
 *   report_data = sha256(hpkePub || nodeKey || nonce) || 0^32          (asks dstack for a TDX quote over it)
 *   eventLog    = dstack RTMR3 event log (compose-hash, app-id, ...)
 *   nvidia      = local verifier pre-flight + evidence for NRAS
 */
export async function collectAttestation(
  hpkePublicKey: string,
  nodeKey: string,
  deps: CollectDeps = defaultCollectDeps,
): Promise<Collected> {
  const nonce = deps.randomNonce();
  const reportData = Buffer.from(expectedReportData(hpkePublicKey, nodeKey, nonce), 'hex');
  const { quote, eventLog } = parseDstackQuote(await deps.quote(reportData));
  const nvidiaEvidence = await collectNvidiaEvidence(nonce, deps.gpu);
  const { rtmr3, named } = replayRtmr3(eventLog as never);
  const bundle: AttestationBundle = {
    tdxQuote: Buffer.from(quote).toString('base64'),
    eventLog,
    nvidiaEvidence,
    hpkePublicKey,
    measurements: { nonce, composeHash: named.get('compose-hash') ?? null, rtmr3 },
  };
  return {
    bundle,
    receipt: {
      quoteHash: sha256Hex(quote),
      rtmr3,
      gpuEvidenceHash: sha256Hex(canonicalJson(nvidiaEvidence)),
      hpkeKeyHash: sha256(Buffer.from(hpkePublicKey, 'base64')).toString('hex'),
    },
  };
}
