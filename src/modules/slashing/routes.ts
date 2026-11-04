import {
  GetAdminJobReportsReq,
  PostAdminJobReportResolveReq,
  PostAdminNodeBanReq,
  PostAdminNodeSuspendReq,
  PostAdminSlashDismissReq,
  PostAdminSlashSubmittedReq,
} from '@spindle/shared/api/admin';
import type { Context, Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { rateLimit } from '../../lib/ratelimit';
import { PostAppReceiptReportReq } from '../../shared/api/earnings';
import { requireAdmin, requireFreshAuth, requireSession } from '../auth/middleware';
import { createReport, dismissReport, listReports, upholdReport } from './reports';
import {
  banNode,
  caseEvidence,
  dismissCase,
  listCases,
  markSubmitted,
  suspendNode,
  unsuspendNode,
} from './service';

const actor = (c: Context<Env>): string => c.get('user')?.address ?? 'admin';

async function body<T>(c: Context<Env>, schema: { safeParse(v: unknown): { success: boolean; data?: T } }) {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid request body.');
  return parsed.data as T;
}

const reportLimit = rateLimit({
  name: 'job_report',
  key: (c) => c.get('user')?.address ?? '',
  points: 20,
  windowSec: 3600,
});

export function slashingRoutes(app: Hono<Env>): void {
  app.post('/v1/app/receipts/:jobId/report', requireSession, reportLimit, async (c) => {
    const req = await body(c, PostAppReceiptReportReq);
    return c.json(await createReport(c.get('user')?.address ?? '', c.req.param('jobId'), req));
  });

  app.get('/v1/admin/job-reports', requireAdmin, async (c) => {
    const parsed = GetAdminJobReportsReq.safeParse(c.req.query());
    if (!parsed.success) throw new AppError('VALIDATION', 'Invalid query.');
    return c.json(await listReports(parsed.data.status));
  });

  app.post('/v1/admin/job-reports/:id/uphold', requireAdmin, requireFreshAuth, async (c) => {
    const { resolution } = await body(c, PostAdminJobReportResolveReq);
    return c.json(await upholdReport(c.req.param('id'), resolution, actor(c)));
  });

  app.post('/v1/admin/job-reports/:id/dismiss', requireAdmin, requireFreshAuth, async (c) => {
    const { resolution } = await body(c, PostAdminJobReportResolveReq);
    return c.json(await dismissReport(c.req.param('id'), resolution, actor(c)));
  });

  app.get('/v1/admin/slash-cases', requireAdmin, async (c) => c.json(await listCases()));

  app.get('/v1/admin/slash-cases/:id/evidence.json', requireAdmin, async (c) => {
    const evidence = await caseEvidence(c.req.param('id'));
    return c.json(evidence as Record<string, unknown>);
  });

  app.post('/v1/admin/slash-cases/:id/submitted', requireAdmin, async (c) => {
    const { txHash } = await body(c, PostAdminSlashSubmittedReq);
    return c.json(await markSubmitted(c.req.param('id'), txHash, actor(c)));
  });

  app.post('/v1/admin/slash-cases/:id/dismiss', requireAdmin, async (c) => {
    const { reason } = await body(c, PostAdminSlashDismissReq);
    return c.json(await dismissCase(c.req.param('id'), reason, actor(c)));
  });

  app.post('/v1/admin/nodes/:id/suspend', requireAdmin, async (c) => {
    const { reason } = await body(c, PostAdminNodeSuspendReq);
    await suspendNode(c.req.param('id'), reason ?? 'suspended by admin', { actor: actor(c) });
    return c.json({ ok: true });
  });

  app.post('/v1/admin/nodes/:id/ban', requireAdmin, requireFreshAuth, async (c) => {
    const { reason } = await body(c, PostAdminNodeBanReq);
    return c.json(await banNode(c.req.param('id'), reason, actor(c)));
  });

  app.post('/v1/admin/nodes/:id/unsuspend', requireAdmin, async (c) => {
    await unsuspendNode(c.req.param('id'), actor(c));
    return c.json({ ok: true });
  });
}

export default slashingRoutes;
