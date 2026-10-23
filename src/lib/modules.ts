import type { Hono } from 'hono';
import adminRoutes from '../modules/admin/routes';
import auth from '../modules/auth/routes';
import buyers from '../modules/buyers/routes';
import canaryJobs from '../modules/canary/jobs';
import cardWebhooks from '../modules/card-webhooks/routes';
import cardsJobs from '../modules/cards/jobs';
import cardRoutes from '../modules/cards/routes';
import chainJobs from '../modules/chain/jobs';
import epochJobs from '../modules/epochs/jobs';
import epochRoutes from '../modules/epochs/routes';
import floorJobs from '../modules/floor/jobs';
import gatewayJobs from '../modules/gateway/jobs';
import gateway from '../modules/gateway/routes';
import health from '../modules/health/routes';
import indexerJobs from '../modules/indexer/jobs';
import meRoutes from '../modules/me/routes';
import meteringJobs from '../modules/metering/jobs';
import networkRoutes from '../modules/network/routes';
import nodesRoutes from '../modules/nodes/routes';
import openapi from '../modules/openapi/routes';
import probeJobs from '../modules/probes/jobs';
import ratesJobs from '../modules/rates/jobs';
import receipts from '../modules/receipts/routes';
import slashing from '../modules/slashing/routes';
import stocksJobs from '../modules/stocks/jobs';
import stocks from '../modules/stocks/routes';
import x402Jobs from '../modules/x402/jobs';
import x402Routes from '../modules/x402/routes';
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
  x402Routes,
  receipts,
  epochRoutes,
  slashing,
  meRoutes,
  networkRoutes,
  adminRoutes,
  openapi,
] as const;
export const jobModules: readonly JobModule[] = [
  chainJobs,
  stocksJobs,
  cardsJobs,
  indexerJobs,
  gatewayJobs,
  x402Jobs,
  ratesJobs,
  meteringJobs,
  epochJobs,
  canaryJobs,
  probeJobs,
  floorJobs,
] as const;
