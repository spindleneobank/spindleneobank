/**
 * Buyer reports. The network trusts providers to serve the model they claim, and bans the ones who don't, so a
 * buyer who thinks a job was wrong needs a way to say so. A report does nothing by itself: anyone could pay for
 * one job to report a competitor, so only an admin's decision affects the node. The platform keeps no prompts or
 * outputs, so the case holds the job's facts, its receipt and what the buyer wrote.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { auditLog, buyers, jobReports, jobs, nodes, receipts } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { JobReportReason, JobReportStatus } from '../../shared/enums';
import { receiptToBase64 } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import { canReportJob } from '../receipts/service';
import { banNode } from './service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createReport(
  address: string,
  jobId: string,
  input: { reason: JobReportReason; details?: string | undefined },
) {
  const missing = new AppError('NOT_FOUND', 'Job not found.');
  if (!UUID_RE.test(jobId)) throw missing;
  const me = address.toLowerCase();
  const [row] = await dbRef.db
    .select({ nodeId: jobs.nodeId, buyer: buyers.address })
    .from(jobs)
    .innerJoin(buyers, eq(buyers.id, jobs.buyerId))
    .where(eq(jobs.id, jobId));
  // "not yours" looks like "missing", as it does for receipts
  if (!row?.nodeId || row.buyer !== me) throw missing;
  if (!(await canReportJob(jobId))) {
    throw new AppError('CONFLICT', 'This job can no longer be reported.');
  }
  const [report] = await dbRef.db
    .insert(jobReports)
    .values({ jobId, nodeId: row.nodeId, reporter: me, reason: input.reason, details: input.details || null })
    .onConflictDoNothing()
    .returning({ id: jobReports.id });
  if (!report) throw new AppError('CONFLICT', 'This job can no longer be reported.');
  return { id: report.id, status: 'open' as const };
}

export async function listReports(status: JobReportStatus) {
  const rows = await dbRef.db
    .select({
      report: jobReports,
      job: jobs,
      node: nodes,
      receipt: receipts,
      openOnNode: sql<number>`(select count(*)::int from job_reports o
        where o.node_id = ${jobReports.nodeId} and o.status = 'open')`,
    })
    .from(jobReports)
    .innerJoin(jobs, eq(jobs.id, jobReports.jobId))
    .innerJoin(nodes, eq(nodes.id, jobReports.nodeId))
    .leftJoin(receipts, eq(receipts.jobId, jobReports.jobId))
    .where(eq(jobReports.status, status))
    .orderBy(desc(jobReports.createdAt))
    .limit(200);
  return rows.map(({ report, job, node, receipt, openOnNode }) => ({
    id: report.id,
    status: report.status,
    reason: report.reason,
    details: report.details,
    reporter: report.reporter,
    createdAt: report.createdAt.toISOString(),
    resolution: report.resolution,
    resolvedBy: report.resolvedBy,
    openReportsOnNode: openOnNode,
    node: {
      id: node.id,
      name: node.name,
      owner: node.owner,
      status: node.status,
      gpuModel: node.gpuModel,
      stakeSpdl: String(node.stakeSpdl),
    },
    job: {
      id: job.id,
      model: job.model,
      kind: job.kind,
      lane: job.lane,
      units: job.units,
      chargeMicros: job.buyerUsdgMicros.toString(),
      createdAt: job.createdAt.toISOString(),
    },
    receipt: receipt
      ? {
          verified: receipt.verified,
          reason: receipt.reason,
          cose: receiptToBase64(receipt.cose),
          payload: receipt.payload,
        }
      : null,
  }));
}

/** Open -> `status`, atomically, so two admins cannot both decide one report. */
async function resolve(id: string, status: 'upheld' | 'dismissed', resolution: string, actor: string) {
  if (!UUID_RE.test(id)) throw new AppError('NOT_FOUND', 'Report not found.');
  const [row] = await dbRef.db
    .update(jobReports)
    .set({ status, resolution, resolvedBy: actor, resolvedAt: new Date() })
    .where(and(eq(jobReports.id, id), eq(jobReports.status, 'open')))
    .returning();
  if (row) {
    await dbRef.db.insert(auditLog).values({
      actor,
      action: `job_report.${status === 'upheld' ? 'uphold' : 'dismiss'}`,
      subject: id,
      details: { resolution, nodeId: row.nodeId, jobId: row.jobId },
    });
    return row;
  }
  const [existing] = await dbRef.db.select().from(jobReports).where(eq(jobReports.id, id));
  if (!existing) throw new AppError('NOT_FOUND', 'Report not found.');
  throw new AppError('CONFLICT', `Report is ${existing.status}, not open.`);
}

export async function dismissReport(id: string, resolution: string, actor: string) {
  await resolve(id, 'dismissed', resolution, actor);
  return { status: 'dismissed' as const };
}

/** The buyer was right: the node is banned and its unposted earnings are withheld. */
export async function upholdReport(id: string, resolution: string, actor: string) {
  const report = await resolve(id, 'upheld', resolution, actor);
  const ban = await banNode(report.nodeId, `report upheld: ${resolution}`, actor);
  return { status: 'upheld' as const, ...ban };
}
