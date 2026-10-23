import type { Hono } from 'hono';
import auth from '../modules/auth/routes';
import cardWebhooks from '../modules/card-webhooks/routes';
import cardsJobs from '../modules/cards/jobs';
import cardRoutes from '../modules/cards/routes';
import chainJobs from '../modules/chain/jobs';
import health from '../modules/health/routes';
import nodesRoutes from '../modules/nodes/routes';
import stocksJobs from '../modules/stocks/jobs';
import stocks from '../modules/stocks/routes';
import type { Env } from './http';
import type { WorkerCtx } from './queue';

// Static import list (no filesystem globbing, so `bun build` works).
// Each module adds one import line and one entry here.
export type RouteModule = (app: Hono<Env>) => void;
export type JobModule = (ctx: WorkerCtx) => void | Promise<void>;

export const routeModules: readonly RouteModule[] = [
  auth,
  health,
  stocks,
  nodesRoutes,
  cardRoutes,
  cardWebhooks,
] as const;
export const jobModules: readonly JobModule[] = [chainJobs, stocksJobs, cardsJobs] as const;
