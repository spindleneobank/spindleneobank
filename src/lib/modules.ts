import type { Hono } from 'hono';
import auth from '../modules/auth/routes';
import chainJobs from '../modules/chain/jobs';
import health from '../modules/health/routes';
import type { Env } from './http';
import type { WorkerCtx } from './queue';

// Static import list (no filesystem globbing, so `bun build` works).
// Each module adds one import line and one entry here.
export type RouteModule = (app: Hono<Env>) => void;
export type JobModule = (ctx: WorkerCtx) => void | Promise<void>;

export const routeModules: readonly RouteModule[] = [auth, health] as const;
export const jobModules: readonly JobModule[] = [chainJobs] as const;
