import { PutAdminModelsReq, PutAdminRateCardReq } from '@spindle/shared/api/admin';
import type { Context, Hono } from 'hono';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { requireAdmin } from '../auth/middleware';
import { floorStatus } from '../floor/service';
import { defaultRunDeps, type RunDeps, runAdminJob } from './registry';
import {
  type AdminDeps,
  audit,
  defaultAdminDeps,
  getModels,
  getRateCard,
  overview,
  putModels,
  putRateCard,
} from './service';

const actor = (c: Context<Env>): string => c.get('user')?.address ?? 'admin';

async function body<T>(c: Context<Env>, schema: { safeParse(v: unknown): { success: boolean; data?: T } }) {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid request body.');
  return parsed.data as T;
}

const bigintSafe = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export const createAdminRoutes =
  (deps: AdminDeps = defaultAdminDeps, run: RunDeps = defaultRunDeps) =>
  (app: Hono<Env>): void => {
    app.get('/v1/admin/overview', requireAdmin, async (c) => c.json(await overview(deps)));

    app.get('/v1/admin/rate-card', requireAdmin, async (c) => c.json(await getRateCard()));
    app.put('/v1/admin/rate-card', requireAdmin, async (c) => {
      const { rows } = await body(c, PutAdminRateCardReq);
      return c.json(await putRateCard(rows, actor(c)));
    });

    app.get('/v1/admin/models', requireAdmin, async (c) => c.json(await getModels()));
    app.put('/v1/admin/models', requireAdmin, async (c) => {
      const { models } = await body(c, PutAdminModelsReq);
      return c.json(await putModels(models, actor(c), deps));
    });

    app.get('/v1/admin/floor', requireAdmin, async (c) => {
      const f = await floorStatus();
      return c.json(
        bigintSafe({ ...f, perEpoch: f.perEpoch.map((p) => ({ ...p, epoch: Number(p.epoch) })) }),
      );
    });

    app.post('/v1/admin/jobs/:name/run', requireAdmin, async (c) => {
      const name = c.req.param('name');
      const out = await runAdminJob(name, actor(c), run);
      await audit(actor(c), 'admin.job.run', name, { mode: out.mode });
      return c.json(out);
    });
  };

export default createAdminRoutes();
