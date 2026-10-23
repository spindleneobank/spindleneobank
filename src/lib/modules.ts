import type { Hono } from 'hono';
import auth from '../modules/auth/routes';
import buyers from '../modules/buyers/routes';
import cardWebhooks from '../modules/card-webhooks/routes';
import cardsJobs from '../modules/cards/jobs';
import cardRoutes from '../modules/cards/routes';
import chainJobs from '../modules/chain/jobs';
import gatewayJobs from '../modules/gateway/jobs';
import gateway from '../modules/gateway/routes';
import health from '../modules/health/routes';
import indexerJobs from '../modules/indexer/jobs';
import meteringJobs from '../modules/metering/jobs';
import nodesRoutes from '../modules/nodes/routes';
import ratesJobs from '../modules/rates/jobs';
import receipts from '../modules/receipts/routes';
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
  buyers,
  gateway,
  cardRoutes,
  cardWebhooks,
  receipts,
] as const;
export const jobModules: readonly JobModule[] = [
  chainJobs,
  stocksJobs,
  cardsJobs,
  indexerJobs,
  gatewayJobs,
  ratesJobs,
  meteringJobs,
] as const;
