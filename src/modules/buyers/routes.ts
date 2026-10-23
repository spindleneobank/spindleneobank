import type { Hono } from 'hono';
import type { Env } from '../../lib/http';
import { apiKeyRoutes } from './apikeys';

export default function buyerRoutes(app: Hono<Env>): void {
  apiKeyRoutes(app);
}
