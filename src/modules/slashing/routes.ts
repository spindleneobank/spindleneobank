import {
  PostAdminNodeSuspendReq,
  PostAdminSlashDismissReq,
  PostAdminSlashSubmittedReq,
} from '@spindle/shared/api/admin';
import type { Context, Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { requireAdmin } from '../auth/middleware';
import { caseEvidence, dismissCase, listCases, markSubmitted, suspendNode, unsuspendNode } from './service';

const actor = (c: Context<Env>): string => c.get('user')?.address ?? 'admin';

async function body<T>(c: Context<Env>, schema: { safeParse(v: unknown): { success: boolean; data?: T } }) {
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid request body.');
  return parsed.data as T;
}

export function slashingRoutes(app: Hono<Env>): void {
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

  app.post('/v1/admin/nodes/:id/unsuspend', requireAdmin, async (c) => {
    await unsuspendNode(c.req.param('id'), actor(c));
    return c.json({ ok: true });
  });
}

export default slashingRoutes;
