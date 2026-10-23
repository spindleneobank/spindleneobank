import { and, desc, eq, gt, isNotNull } from 'drizzle-orm';
import { nodeAttestations, nodes } from '../../db/schema';
import { logger } from '../../lib/logger';
import { canonicalJson, sha256Hex } from '../../shared/canonical-json';
import type { AttestationBundle } from '../../shared/node-protocol';
import type { ReceiptPayload } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import type { AttestationResult, VerifyJob } from '../receipts/verify';
import { verifyNvidia } from './nvidia';
import { attestSettings, loadAllowlist } from './settings';
import {
  AttestError,
  expectedReportData,
  parseEventLog,
  replayRtmr3,
  sha256,
  type TdxMeasurements,
  verifyTdxQuote,
} from './tdx';

/** Hashes a receipt must echo (`ReceiptPayload.attestation`) plus what the allowlist matched. */
export interface AttestationEvidence {
  quoteHash: string;
  rtmr3: string;
  gpuEvidenceHash: string;
  hpkeKeyHash: string;
  hpkePublicKey: string;
  composeHash: string;
  tcbStatus: string;
  advisoryIds: string[];
  mrTd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  nonce: string;
  gpuArch: string;
}

export type VerifyOutcome =
  | { ok: true; evidence: AttestationEvidence }
  | { ok: false; reason: string; detail?: string };

const NONCE = /^[0-9a-fA-F]{64}$/;

/** Checks the TDX measurements against the allowlist. Fail-closed on empty lists. */
export function checkAllowlist(m: TdxMeasurements, composeHash: string | undefined): void {
  const a = loadAllowlist();
  const lists: [string, string[], string | undefined][] = [
    ['mrTd', a.mrTd, m.mrTd],
    ['rtmr0', a.rtmr0, m.rtmr0],
    ['rtmr1', a.rtmr1, m.rtmr1],
    ['rtmr2', a.rtmr2, m.rtmr2],
    ['composeHash', a.composes.map((c) => c.composeHash), composeHash],
  ];
  for (const [name, list, value] of lists) {
    if (list.length === 0) throw new AttestError('ALLOWLIST_EMPTY', `no approved ${name} configured`);
    if (!value || !list.map((x) => x.toLowerCase()).includes(value.toLowerCase()))
      throw new AttestError('NOT_ALLOWLISTED', `${name} ${value ?? '(missing)'} is not approved`);
  }
}

/**
 * Full attestation check of a bundle sent by `nodeKey`:
 *  1. DCAP verification of the TDX quote (+ allowed TCB status)
 *  2. report_data == sha256(hpkePub || nodeKey || nonce)
 *  3. RTMR3 replayed from the event log == quote RTMR3; MRTD / RTMR0-2 / compose hash on the allowlist
 *  4. NVIDIA GPU evidence verified by NRAS (JWT signature, overall result, nonce)
 * Pure with respect to the DB; never throws.
 */
export async function verifyAttestation(bundle: AttestationBundle, nodeKey: string): Promise<VerifyOutcome> {
  try {
    const quoteBytes = Buffer.from(bundle.tdxQuote, 'base64');
    if (quoteBytes.length < 100) throw new AttestError('TDX_QUOTE_MALFORMED');
    const nonce = String((bundle.nvidiaEvidence as { nonce?: unknown } | null)?.nonce ?? '');
    if (!NONCE.test(nonce)) throw new AttestError('BAD_NONCE', 'nvidiaEvidence.nonce must be 32 bytes hex');

    const tdx = await verifyTdxQuote(quoteBytes);

    // 2. binding of the HPKE key and the node key to this quote
    if (tdx.reportData !== expectedReportData(bundle.hpkePublicKey, nodeKey, nonce))
      throw new AttestError(
        'REPORT_DATA_MISMATCH',
        'quote report_data does not bind the HPKE key and node key',
      );

    // 3. measurements
    const { rtmr3, named } = replayRtmr3(parseEventLog(bundle.eventLog));
    if (rtmr3 !== tdx.rtmr3)
      throw new AttestError('RTMR3_MISMATCH', 'event log does not replay to the quote RTMR3');
    const composeHash = named.get('compose-hash');
    checkAllowlist(tdx, composeHash);

    // 4. GPU
    const gpu = await verifyNvidia(bundle.nvidiaEvidence);
    void gpu;

    return {
      ok: true,
      evidence: {
        quoteHash: sha256Hex(quoteBytes),
        rtmr3,
        gpuEvidenceHash: sha256Hex(canonicalJson(bundle.nvidiaEvidence)),
        hpkeKeyHash: sha256(Buffer.from(bundle.hpkePublicKey, 'base64')).toString('hex'),
        hpkePublicKey: bundle.hpkePublicKey,
        composeHash: composeHash as string,
        tcbStatus: tdx.tcbStatus,
        advisoryIds: tdx.advisoryIds,
        mrTd: tdx.mrTd,
        rtmr0: tdx.rtmr0,
        rtmr1: tdx.rtmr1,
        rtmr2: tdx.rtmr2,
        nonce,
        gpuArch: (bundle.nvidiaEvidence as { arch: string }).arch,
      },
    };
  } catch (e) {
    if (e instanceof AttestError) return { ok: false, reason: e.reason, detail: e.message.slice(0, 300) };
    logger.error({ err: String(e) }, 'attestation verification crashed');
    return { ok: false, reason: 'INTERNAL', detail: String(e).slice(0, 300) };
  }
}

// ---- persistence ------------------------------------------------------------------------------------------

/**
 * Verifies and records an attestation for a node. Success: row with `verified` and a 1 h expiry,
 * `nodes.last_attest_at = now`, `cc_capable = true`. Failure: the reason is stored and `last_attest_at` is
 * cleared so the scheduler stops sending sealed jobs to the node.
 */
export async function recordAttestation(
  nodeId: string,
  nodeKey: string,
  bundle: AttestationBundle,
): Promise<VerifyOutcome> {
  const db = dbRef.db;
  let out = await verifyAttestation(bundle, nodeKey);
  if (out.ok) {
    // replay protection: a quote that was already accepted cannot refresh freshness again
    const [dup] = await db
      .select({ id: nodeAttestations.id })
      .from(nodeAttestations)
      .where(and(eq(nodeAttestations.quoteHash, out.evidence.quoteHash), eq(nodeAttestations.verified, true)))
      .limit(1);
    if (dup) out = { ok: false, reason: 'REPLAY', detail: 'quote was already used' };
  }
  const now = new Date();
  // the stored bundle is for audit; the raw quote can be large but stays bounded by the WS frame limit
  await db.insert(nodeAttestations).values({
    nodeId,
    quoteHash: out.ok ? out.evidence.quoteHash : sha256Hex(Buffer.from(bundle.tdxQuote, 'base64')),
    bundle,
    verified: out.ok,
    reason: out.ok ? null : `${out.reason}${out.detail ? `: ${out.detail}` : ''}`.slice(0, 500),
    measurements: out.ok ? out.evidence : null,
    expiresAt: out.ok ? new Date(now.getTime() + attestSettings.ttlMs) : null,
  });
  await db
    .update(nodes)
    .set(out.ok ? { lastAttestAt: now, ccCapable: true } : { lastAttestAt: null })
    .where(eq(nodes.id, nodeId));
  if (!out.ok) logger.warn({ nodeId, reason: out.reason }, 'sealed attestation rejected');
  return out;
}

/** A session without (fresh) evidence: the node must not receive sealed jobs until it attests. */
export async function clearAttestation(nodeId: string): Promise<void> {
  await dbRef.db.update(nodes).set({ lastAttestAt: null }).where(eq(nodes.id, nodeId));
}

export interface AttestedNode {
  attestationId: string;
  nodeId: string;
  nodeKey: string;
  hpkePublicKey: string;
  expiresAt: Date;
  summary: Pick<
    AttestationEvidence,
    'quoteHash' | 'rtmr3' | 'gpuEvidenceHash' | 'hpkeKeyHash' | 'composeHash' | 'tcbStatus' | 'gpuArch'
  >;
}

/** Latest verified, unexpired attestation of a node (null when the node has none). */
export async function latestAttestation(nodeId: string, at: Date = new Date()): Promise<AttestedNode | null> {
  const [row] = await dbRef.db
    .select({ a: nodeAttestations, nodeKey: nodes.nodeKey })
    .from(nodeAttestations)
    .innerJoin(nodes, eq(nodes.id, nodeAttestations.nodeId))
    .where(
      and(
        eq(nodeAttestations.nodeId, nodeId),
        eq(nodeAttestations.verified, true),
        gt(nodeAttestations.expiresAt, at),
        isNotNull(nodes.lastAttestAt), // cleared on a failed refresh or a new session without evidence
      ),
    )
    .orderBy(desc(nodeAttestations.createdAt))
    .limit(1);
  if (!row) return null;
  const m = row.a.measurements as AttestationEvidence;
  return {
    attestationId: row.a.id,
    nodeId,
    nodeKey: row.nodeKey,
    hpkePublicKey: m.hpkePublicKey,
    expiresAt: row.a.expiresAt as Date,
    summary: {
      quoteHash: m.quoteHash,
      rtmr3: m.rtmr3,
      gpuEvidenceHash: m.gpuEvidenceHash,
      hpkeKeyHash: m.hpkeKeyHash,
      composeHash: m.composeHash,
      tcbStatus: m.tcbStatus,
      gpuArch: m.gpuArch,
    },
  };
}

/**
 * Receipt rule 6 (sealed lane): the receipt's attestation hashes must match a verified `node_attestations`
 * row of the serving node that was still valid when the job finished. Replaces the B7 stub.
 */
export async function verifyReceiptAttestation(
  job: VerifyJob,
  payload: ReceiptPayload,
): Promise<AttestationResult> {
  const att = payload.attestation;
  if (!att) return { ok: false, reason: 'NO_RECEIPT_ATTESTATION' };
  const rows = await dbRef.db
    .select({ a: nodeAttestations })
    .from(nodeAttestations)
    .innerJoin(nodes, eq(nodes.id, nodeAttestations.nodeId))
    .where(
      and(
        eq(nodes.nodeKey, job.nodeKey.toLowerCase()),
        eq(nodeAttestations.quoteHash, att.quoteHash),
        eq(nodeAttestations.verified, true),
      ),
    )
    .limit(1);
  const a = rows[0]?.a;
  if (!a?.expiresAt) return { ok: false, reason: 'ATTESTATION_UNKNOWN' };
  const m = a.measurements as AttestationEvidence;
  if (m.rtmr3 !== att.rtmr3 || m.gpuEvidenceHash !== att.gpuEvidenceHash || m.hpkeKeyHash !== att.hpkeKeyHash)
    return { ok: false, reason: 'ATTESTATION_MISMATCH' };
  if (payload.finishedAt > a.expiresAt.getTime()) return { ok: false, reason: 'ATTESTATION_STALE' };
  if (payload.startedAt < a.createdAt.getTime() - attestSettings.ttlMs)
    return { ok: false, reason: 'ATTESTATION_STALE' };
  return { ok: true, ref: a.id };
}
