/**
 * Slash cases and node suspension.
 *
 * The backend NEVER signs or sends `slash`. It produces the evidence bundle, its keccak256 hash and a
 * ready-made Safe transaction (`to` = staking, `data` = slash(nodeId, bps, evidenceHash)) that the
 * owner's slasher Safe executes by hand. The only on-chain call built here is `encodeFunctionData`.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { type Address, encodeFunctionData, type Hex, keccak256, stringToBytes } from 'viem';
import { auditLog, canaryResults, kv, nodes, probeResults, receipts, slashCases } from '../../db/schema';
import { addresses } from '../../lib/contracts';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { spindleStakingAbi } from '../../shared/abi';
import { canonicalJson } from '../../shared/canonical-json';
import { CLOSE_CODES } from '../../shared/node-protocol';
import { receiptToBase64 } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import { requestFromWorker } from '../nodes/jobs';

export type SlashReason = 'canary_fraud' | 'probe_misrepresentation' | 'receipt_fraud';

const envBps = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : dflt;
};

/** Proposed slash sizes in basis points; override with SLASH_BPS_* env or mutate in tests. */
export const slashSettings: Record<SlashReason, number> = {
  canary_fraud: envBps('SLASH_BPS_CANARY', 2000),
  probe_misrepresentation: envBps('SLASH_BPS_PROBE', 1000),
  receipt_fraud: envBps('SLASH_BPS_RECEIPT', 5000),
};

export const slashingDeps = {
  /** Drops the node's websocket (code 4004). Goes through the Redis bridge; failures are not fatal. */
  closeNode: async (nodeId: string): Promise<void> => {
    await requestFromWorker({ type: 'close', nodeId, code: CLOSE_CODES.SUSPENDED }, { timeoutMs: 5_000 });
  },
  stakingAddress: (): Address | undefined => addresses().staking,
};

// ---- evidence ---------------------------------------------------------------------------------------

export interface Evidence {
  v: 1;
  reason: SlashReason;
  nodeId: string;
  onchainNodeId: string | null;
  nodeKey: string;
  canaries: unknown[];
  probes: unknown[];
  /** Receipts of the failed canary jobs: base64 COSE_Sign1 as the node signed them. */
  receipts: { jobId: string; cose: string; verified: boolean; reason: string | null }[];
}

/** keccak256 over the canonical JSON (UTF-8). Deterministic: key order and whitespace do not matter. */
export function evidenceHash(evidence: unknown): Hex {
  return keccak256(stringToBytes(canonicalJson(evidence)));
}

const EVIDENCE_WINDOW_MS = 24 * 3600_000;

/** Latest unsuspend time, so history from before an owner cleared the node no longer counts. */
export async function sinceUnsuspend(nodeId: string, floor: Date): Promise<Date> {
  const [row] = await dbRef.db
    .select()
    .from(kv)
    .where(eq(kv.key, `node:unsuspended:${nodeId}`));
  const t = typeof row?.value === 'string' ? new Date(row.value) : null;
  return t && t > floor ? t : floor;
}

export async function buildEvidence(nodeId: string, reason: SlashReason): Promise<Evidence> {
  const db = dbRef.db;
  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
  if (!node) throw new AppError('NOT_FOUND', 'Node not found.');
  const since = await sinceUnsuspend(nodeId, new Date(Date.now() - EVIDENCE_WINDOW_MS));
  const canaries = await db
    .select()
    .from(canaryResults)
    .where(and(eq(canaryResults.nodeId, nodeId), gte(canaryResults.createdAt, since)))
    .orderBy(desc(canaryResults.createdAt))
    .limit(50);
  const probes = await db
    .select()
    .from(probeResults)
    .where(and(eq(probeResults.nodeId, nodeId), gte(probeResults.createdAt, since)))
    .orderBy(desc(probeResults.createdAt))
    .limit(20);
  const failedJobs = canaries.filter((c) => !c.pass && c.jobId).map((c) => c.jobId as string);
  const rcpts = failedJobs.length
    ? await db.select().from(receipts).where(inArray(receipts.jobId, failedJobs))
    : [];
  return {
    v: 1,
    reason,
    nodeId,
    onchainNodeId: node.onchainId === null ? null : node.onchainId.toString(),
    nodeKey: node.nodeKey,
    canaries: canaries.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      kind: c.kind,
      expected: c.expected,
      observed: c.observed,
      pass: c.pass,
      createdAt: c.createdAt.toISOString(),
    })),
    probes: probes.map((p) => ({
      id: p.id,
      vramGb: p.vramGb,
      tokPerSec: p.tokPerSec,
      classOk: p.classOk,
      details: p.details,
      createdAt: p.createdAt.toISOString(),
    })),
    receipts: rcpts.map((r) => ({
      jobId: r.jobId,
      cose: receiptToBase64(r.cose),
      verified: r.verified,
      reason: r.reason,
    })),
  };
}

// ---- cases ------------------------------------------------------------------------------------------

export type SlashCaseRow = typeof slashCases.$inferSelect;

/**
 * Opens a case for a node. At most one case per node + reason is open at a time (partial unique index),
 * so concurrent callers get the same row. A case that predates the node's last unsuspend is superseded
 * (dismissed, audited) and a fresh one with fresh evidence is opened. `evidence` defaults to the node's
 * recent canary/probe rows and failed-canary receipts.
 */
export async function openCase(
  nodeId: string,
  reason: SlashReason,
  evidence?: unknown,
  proposedBps: number = slashSettings[reason],
): Promise<SlashCaseRow> {
  const db = dbRef.db;
  const findOpen = async () => {
    const [row] = await db
      .select()
      .from(slashCases)
      .where(and(eq(slashCases.nodeId, nodeId), eq(slashCases.reason, reason), eq(slashCases.status, 'open')))
      .limit(1);
    return row;
  };
  const existing = await findOpen();
  if (existing) {
    const cleared = await sinceUnsuspend(nodeId, new Date(0));
    if (existing.createdAt >= cleared) return existing;
    const dismissed = await db
      .update(slashCases)
      .set({ status: 'dismissed' })
      .where(and(eq(slashCases.id, existing.id), eq(slashCases.status, 'open')))
      .returning({ id: slashCases.id });
    if (dismissed.length > 0)
      await db.insert(auditLog).values({
        actor: 'system',
        action: 'slash_case.dismiss',
        subject: existing.id,
        details: { reason: 'superseded by a new offence after unsuspend', nodeId },
      });
  }
  const body = JSON.parse(JSON.stringify(evidence ?? (await buildEvidence(nodeId, reason)))) as unknown;
  const [row] = await db
    .insert(slashCases)
    .values({ nodeId, reason, evidence: body, evidenceHash: evidenceHash(body), proposedBps, status: 'open' })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const raced = await findOpen(); // another caller opened it between our check and insert
    if (!raced) throw new Error('slash case insert failed');
    return raced;
  }
  await db.insert(auditLog).values({
    actor: 'system',
    action: 'slash_case.open',
    subject: row.id,
    details: { nodeId, reason, proposedBps, evidenceHash: row.evidenceHash },
  });
  logger.warn({ nodeId, reason, caseId: row.id }, 'slash case opened');
  return row;
}

export interface SafeTx {
  to: Address;
  data: Hex;
  value: '0';
}

/** `slash(onchainNodeId, bps, evidenceHash)` calldata for the owner's Safe; null if it cannot be built. */
export function safeTxFor(c: Pick<SlashCaseRow, 'evidenceHash' | 'proposedBps'>, onchainId: bigint | null) {
  const to = slashingDeps.stakingAddress();
  if (!to || onchainId === null || !c.evidenceHash || c.proposedBps === null) return null;
  const data = encodeFunctionData({
    abi: spindleStakingAbi,
    functionName: 'slash',
    args: [onchainId, c.proposedBps, c.evidenceHash as Hex],
  });
  return { to, data, value: '0' } satisfies SafeTx;
}

export async function listCases() {
  const rows = await dbRef.db
    .select({ c: slashCases, onchainId: nodes.onchainId })
    .from(slashCases)
    .innerJoin(nodes, eq(nodes.id, slashCases.nodeId))
    .orderBy(desc(slashCases.createdAt));
  return rows.map(({ c, onchainId }) => ({
    id: c.id,
    nodeId: c.nodeId,
    onchainNodeId: onchainId === null ? null : onchainId.toString(),
    reason: c.reason,
    evidence: c.evidence,
    evidenceHash: c.evidenceHash,
    proposedBps: c.proposedBps,
    status: c.status,
    txHash: c.txHash,
    createdAt: c.createdAt.toISOString(),
    safeTx: safeTxFor(c, onchainId),
  }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCase(id: string): Promise<SlashCaseRow> {
  if (!UUID_RE.test(id)) throw new AppError('NOT_FOUND', 'Slash case not found.');
  const [row] = await dbRef.db.select().from(slashCases).where(eq(slashCases.id, id));
  if (!row) throw new AppError('NOT_FOUND', 'Slash case not found.');
  return row;
}

export async function caseEvidence(id: string): Promise<unknown> {
  return (await getCase(id)).evidence;
}

/** Open -> `status`, atomically. A case that is not open (or does not exist) cannot be transitioned. */
async function transition(id: string, set: Partial<typeof slashCases.$inferInsert>): Promise<SlashCaseRow> {
  if (!UUID_RE.test(id)) throw new AppError('NOT_FOUND', 'Slash case not found.');
  const [row] = await dbRef.db
    .update(slashCases)
    .set(set)
    .where(and(eq(slashCases.id, id), eq(slashCases.status, 'open')))
    .returning();
  if (row) return row;
  const c = await getCase(id); // 404 if missing
  throw new AppError('CONFLICT', `Case is ${c.status}, not open.`);
}

export async function markSubmitted(id: string, txHash: string, actor: string) {
  const c = await transition(id, { status: 'submitted', txHash });
  await dbRef.db.insert(auditLog).values({
    actor,
    action: 'slash_case.submitted',
    subject: id,
    details: { txHash, nodeId: c.nodeId },
  });
  return { status: 'submitted' as const };
}

export async function dismissCase(id: string, reason: string, actor: string) {
  const c = await transition(id, { status: 'dismissed' });
  await dbRef.db.insert(auditLog).values({
    actor,
    action: 'slash_case.dismiss',
    subject: id,
    details: { reason, nodeId: c.nodeId },
  });
  return { status: 'dismissed' as const };
}

// ---- suspension ----------------------------------------------------------------------------------------

/**
 * Marks the node suspended and drops its connection (close 4004). `auto` callers (canaries, probes)
 * never suspend the house node; an admin may. Returns false when nothing changed.
 */
export async function suspendNode(
  nodeId: string,
  reason: string,
  opts: { actor?: string; auto?: boolean } = {},
): Promise<boolean> {
  const db = dbRef.db;
  if (!UUID_RE.test(nodeId)) throw new AppError('NOT_FOUND', 'Node not found.');
  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
  if (!node) throw new AppError('NOT_FOUND', 'Node not found.');
  if (opts.auto && node.isHouse) return false;
  if (node.status === 'suspended') return false;
  await db.update(nodes).set({ status: 'suspended', suspendedReason: reason }).where(eq(nodes.id, nodeId));
  await db.insert(auditLog).values({
    actor: opts.actor ?? 'system',
    action: 'node.suspend',
    subject: nodeId,
    details: { reason },
  });
  logger.warn({ nodeId, reason }, 'node suspended');
  await slashingDeps
    .closeNode(nodeId)
    .catch((err) => logger.warn({ err: String(err), nodeId }, 'close failed'));
  return true;
}

export async function unsuspendNode(nodeId: string, actor: string): Promise<boolean> {
  const db = dbRef.db;
  if (!UUID_RE.test(nodeId)) throw new AppError('NOT_FOUND', 'Node not found.');
  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
  if (!node) throw new AppError('NOT_FOUND', 'Node not found.');
  if (node.status !== 'suspended') return false;
  await db.update(nodes).set({ status: 'offline', suspendedReason: null }).where(eq(nodes.id, nodeId));
  const now = new Date().toISOString();
  await db
    .insert(kv)
    .values({ key: `node:unsuspended:${nodeId}`, value: now })
    .onConflictDoUpdate({ target: kv.key, set: { value: now, updatedAt: new Date() } });
  await db.insert(auditLog).values({ actor, action: 'node.unsuspend', subject: nodeId, details: {} });
  return true;
}
