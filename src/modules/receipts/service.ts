import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';
import { buyers, earningEvents, jobs, nodes, receipts } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { GatewayView, OnJobFinished } from '../../shared/contracts/jobs';
import type { JobKind } from '../../shared/enums';
import { bpsOf } from '../../shared/money';
import { receiptFromBase64, receiptToBase64 } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import { type CanaryFinished, onCanaryFinished } from '../canary/hooks';
import { actualCharge, buyerRate, type Usage, unitKindFor, utcDay } from '../gateway/pricing';
import { registerJobFinishedHandler, releaseJob, settleJob } from '../gateway/service';
import { type VerifyResult, verifyJobReceipt, withinTolerance } from './verify';

/** Provider share of every verified charge, in basis points. */
export const PROVIDER_SHARE_BPS = 8000;
export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 2000;
export const REPUTATION_FAIL_DELTA = -25;
export const REPUTATION_OK_DELTA = 1;

export const receiptSettings = {
  /**
   * task B7 step 2: a failed receipt still bills the gateway-recounted usage (the buyer got the output)
   * and pays nobody. Set false to release without charging instead.
   */
  chargeOnFailure: true,
};

interface Counts {
  p: number;
  c: number;
  n: number;
}

/** What the buyer is billed for, given the node's signed usage and the gateway's recount. */
export function billedUsage(
  kind: JobKind,
  node: Counts,
  view: GatewayView,
  verified: boolean,
): { usage: Usage; units: number; counts: Counts } | null {
  const gw: Counts | null =
    kind === 'images'
      ? view.images
        ? { p: 0, c: 0, n: view.images.length }
        : null
      : view.recount
        ? { p: view.recount.promptTokens, c: view.recount.completionTokens, n: 0 }
        : null;

  let c: Counts;
  if (!verified) {
    if (!gw) return null; // nothing independent to bill
    c = gw;
  } else if (!gw) {
    c = node; // sealed lane: no recount
  } else if (kind === 'images') {
    c = { p: 0, c: 0, n: Math.min(node.n, gw.n) };
  } else {
    // exact recount within tolerance: bill the recount; estimate or out of tolerance: never above the recount
    const pick = (a: number, b: number) =>
      !view.recountEstimated && withinTolerance(a, b) ? b : Math.min(a, b);
    c = { p: pick(node.p, gw.p), c: kind === 'chat' ? pick(node.c, gw.c) : 0, n: 0 };
  }
  if (kind === 'chat')
    return { usage: { kind, promptTokens: c.p, completionTokens: c.c }, units: c.p + c.c, counts: c };
  if (kind === 'embeddings') return { usage: { kind, promptTokens: c.p }, units: c.p, counts: c };
  return { usage: { kind, images: c.n }, units: c.n, counts: c };
}

/**
 * Called by the gateway (B5) when a node reports `job.done`. One DB transaction, serialized per job by
 * `SELECT ... FOR UPDATE`; a job with a receipt row is a no-op, so a repeat can neither double-charge
 * nor double-earn.
 */
export const onJobFinished: OnJobFinished = async (jobId, done, view) => {
  const pending: { canary?: CanaryFinished } = {};
  await dbRef.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select id from jobs where id = ${jobId} for update`);
    if (locked.length === 0) {
      logger.warn({ jobId }, 'onJobFinished: unknown job');
      return;
    }
    const [existing] = await tx
      .select({ jobId: receipts.jobId })
      .from(receipts)
      .where(eq(receipts.jobId, jobId));
    if (existing) return;

    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) return;
    const [node] = job.nodeId ? await tx.select().from(nodes).where(eq(nodes.id, job.nodeId)) : [];
    if (!node || job.status !== 'completed') {
      logger.warn(
        { jobId, status: job.status },
        'onJobFinished: job not completed or has no node; releasing',
      );
      await releaseJob(jobId);
      return;
    }
    const kind = job.kind as JobKind;
    const lane = (job.lane ?? 'open') as 'open' | 'sealed';

    const v: VerifyResult = await verifyJobReceipt(
      { id: job.id, model: job.model, kind, lane, nodeKey: node.nodeKey, nodePubkey: node.nodePubkey },
      done.receipt,
      view,
    );

    let cose: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    try {
      cose = new Uint8Array(receiptFromBase64(done.receipt));
    } catch {}

    const isCanary = job.isCanary || job.payMode === 'canary';
    const isProbe = job.payMode === 'probe';
    const free = isCanary || isProbe;

    // ---- charge ----
    let charged = 0n;
    let units = Number(job.units);
    let counts: Counts = { p: job.promptTokens ?? 0, c: job.completionTokens ?? 0, n: 0 };
    const nodeCounts: Counts = {
      p: v.payload?.usage.p ?? done.usage.promptTokens,
      c: v.payload?.usage.c ?? done.usage.completionTokens,
      n: v.payload?.usage.n ?? done.usage.images ?? 0,
    };
    const billed = billedUsage(kind, nodeCounts, view, v.verified);
    const mayCharge = !free && billed !== null && (v.verified || receiptSettings.chargeOnFailure);
    if (billed) {
      units = billed.units;
      counts = billed.counts;
    }
    if (mayCharge && billed) {
      const rate = await buyerRate(node.gpuClass, lane, unitKindFor(kind), utcDay(job.createdAt));
      if (!rate) throw new Error(`no rate card row for job ${jobId}`);
      const wanted = actualCharge(billed.usage, rate);
      // finalize clamps to the reservation and returns what was actually charged; null = already settled elsewhere
      charged = (await settleJob(jobId, wanted)) ?? 0n;
    } else {
      await releaseJob(jobId);
    }

    // ---- earnings: verified, non-canary, non-probe only ----
    const provider = v.verified && !free && charged > 0n ? bpsOf(charged, PROVIDER_SHARE_BPS) : 0n;
    if (provider > 0n) {
      await tx.insert(earningEvents).values({
        ts: new Date(),
        nodeId: node.id,
        owner: node.owner,
        jobId,
        kind: 'job',
        usdgMicros: provider,
      });
    }

    await tx.insert(receipts).values({
      jobId,
      nodeId: node.id,
      cose,
      payload: v.payload ?? {},
      attestationRef: v.attestationRef,
      verified: v.verified,
      reason: v.reason,
      recountTokens: v.recountTokens,
    });
    await tx
      .update(jobs)
      .set({
        buyerUsdgMicros: charged,
        providerUsdgMicros: provider,
        units: String(units),
        promptTokens: counts.p,
        completionTokens: counts.c,
        ...(v.verified ? {} : { error: `receipt: ${v.reason}` }),
      })
      .where(eq(jobs.id, jobId));

    if (isCanary) {
      pending.canary = {
        jobId,
        nodeId: node.id,
        verified: v.verified,
        reason: v.reason,
        outputText: view.outputText,
        embeddings: view.embeddings,
      };
    } else {
      const delta = v.verified ? REPUTATION_OK_DELTA : REPUTATION_FAIL_DELTA;
      await tx
        .update(nodes)
        .set({
          reputation: sql`greatest(${REPUTATION_MIN}, least(${REPUTATION_MAX}, ${nodes.reputation} + ${delta}))`,
        })
        .where(eq(nodes.id, node.id));
    }
    if (!v.verified) logger.warn({ jobId, nodeId: node.id, reason: v.reason }, 'receipt rejected');
  });
  if (pending.canary) {
    try {
      await onCanaryFinished(pending.canary);
    } catch (err) {
      logger.error({ err: String(err), jobId }, 'canary hook failed');
    }
  }
};

/** Wires `onJobFinished` into the gateway. Called when the receipts routes mount (API process). */
export function registerReceiptHandler(): void {
  registerJobFinishedHandler(onJobFinished);
}

// ---- read side --------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function receiptView(jobId: string) {
  if (!UUID_RE.test(jobId)) throw new AppError('NOT_FOUND', 'Receipt not found.');
  const [row] = await dbRef.db
    .select({ r: receipts, j: jobs, n: nodes })
    .from(receipts)
    .innerJoin(jobs, eq(jobs.id, receipts.jobId))
    .innerJoin(nodes, eq(nodes.id, receipts.nodeId))
    .where(eq(receipts.jobId, jobId))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Receipt not found.');
  const [ev] = await dbRef.db
    .select({ epoch: earningEvents.epoch, usdgMicros: earningEvents.usdgMicros })
    .from(earningEvents)
    .where(and(eq(earningEvents.jobId, jobId), eq(earningEvents.kind, 'job')))
    .limit(1);
  const payload = row.r.payload as Record<string, unknown> & { usage?: { p: number; c: number; n?: number } };
  return {
    owner: row.n.owner,
    buyerId: row.j.buyerId,
    earning: ev
      ? { providerMicros: ev.usdgMicros.toString(), epoch: ev.epoch === null ? null : Number(ev.epoch) }
      : null,
    view: {
      jobId,
      nodeId: row.n.id,
      onchainNodeId: row.n.onchainId === null ? null : row.n.onchainId.toString(),
      nodeKey: row.n.nodeKey,
      lane: (row.j.lane ?? 'open') as 'open' | 'sealed',
      model: row.j.model,
      usage: payload.usage ?? { p: 0, c: 0 },
      cose: receiptToBase64(row.r.cose),
      payload,
      verified: row.r.verified,
      reason: row.r.reason,
      attestationRef: row.r.attestationRef,
      epoch: ev?.epoch === null || ev === undefined ? null : Number(ev.epoch),
    },
  };
}

/** Public receipt: anyone holding the (unguessable) job id. */
export async function publicReceipt(jobId: string) {
  return (await receiptView(jobId)).view;
}

/** Owner view: only the node owner or the buyer; "not yours" looks like "missing". */
export async function appReceipt(address: string, jobId: string) {
  const r = await receiptView(jobId);
  const me = address.toLowerCase();
  const [buyer] = await dbRef.db
    .select({ address: buyers.address })
    .from(buyers)
    .where(eq(buyers.id, r.buyerId));
  const isOwner = r.owner === me;
  if (!isOwner && buyer?.address !== me) throw new AppError('NOT_FOUND', 'Receipt not found.');
  return { ...r.view, earning: isOwner ? r.earning : null };
}

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
function decodeCursor(c: string | undefined): [Date, string] | null {
  if (!c) return null;
  try {
    const [t, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string];
    const d = new Date(t);
    if (Number.isNaN(d.getTime()) || !UUID_RE.test(id)) throw new Error('bad');
    return [d, id];
  } catch {
    throw new AppError('VALIDATION', 'Invalid cursor.');
  }
}

export async function listAppReceipts(
  address: string,
  q: { lane?: 'open' | 'sealed'; q?: string; cursor?: string; limit: number },
) {
  const me = address.toLowerCase();
  const cur = decodeCursor(q.cursor);
  const conds = [or(eq(nodes.owner, me), eq(buyers.address, me))];
  if (q.lane) conds.push(eq(jobs.lane, q.lane));
  if (q.q) {
    const term = q.q.replace(/[%_\\]/g, '\\$&');
    conds.push(or(ilike(jobs.model, `%${term}%`), sql`${jobs.id}::text ilike ${`%${term}%`}`));
  }
  if (cur) {
    conds.push(or(lt(jobs.createdAt, cur[0]), and(eq(jobs.createdAt, cur[0]), lt(jobs.id, cur[1]))));
  }
  const rows = await dbRef.db
    .select({ j: jobs, n: nodes, verified: receipts.verified })
    .from(jobs)
    .innerJoin(buyers, eq(buyers.id, jobs.buyerId))
    .leftJoin(nodes, eq(nodes.id, jobs.nodeId))
    .leftJoin(receipts, eq(receipts.jobId, jobs.id))
    .where(and(...conds))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(({ j, n, verified }) => ({
      jobId: j.id,
      model: j.model,
      kind: j.kind as JobKind,
      lane: (j.lane ?? 'open') as 'open' | 'sealed',
      nodeName: n?.name ?? '',
      gpu: n?.gpuModel ?? null,
      units: j.units,
      unitKind: j.unitKind as 'tokens_1m' | 'image' | 'job' | 'gpu_hour',
      providerMicros: j.providerUsdgMicros.toString(),
      status: j.status as 'completed',
      verified: verified ?? null,
      createdAt: j.createdAt.toISOString(),
    })),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.j.createdAt, last.j.id) : null,
  };
}
