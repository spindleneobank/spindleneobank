import type { Hono } from 'hono';
import health from '../modules/health/routes';
import type { Env } from './http';
import type { WorkerCtx } from './queue';

// Static import list (no filesystem globbing, so `bun build` works).
// Each module adds one import line and one entry here.
export type RouteModule = (app: Hono<Env>) => void;
export type JobModule = (ctx: WorkerCtx) => void | Promise<void>;

export const routeModules: readonly RouteModule[] = [health] as const;
export const jobModules: readonly JobModule[] = [] as const;
