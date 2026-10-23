import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createMock } from '../../../dev/izipay-mock/server';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { type Env, jsonError } from '../../lib/http';
import { dbRef, settings } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import cardWebhooks from '../card-webhooks/routes';
import cardRoutes from './routes';
import { hooks } from './service';
import { cardSettings } from './settings';

export const ORIGIN = 'http://localhost:7000';
export const MOCK_KEY = 'mock-api-key';
export const MOCK_SECRET = 'mock-api-secret';
export const HOOK_SECRET = 'mock-hook-secret';

export type Kit = {
  t: TestDb;
  app: Hono<Env>;
  mock: ReturnType<typeof createMock>;
  receiver: ReturnType<typeof Bun.serve>;
  /** POST/GET against the in-process app as a signed-in user. */
  as(address: string): Promise<{
    address: string;
    call(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response>;
  }>;
  newUser(): `0x${string}`;
  stop(): Promise<void>;
};

/** Fresh DB handle (no truncation: tests use unique users), in-process izipay mock, scoped Redis keys. */
export async function bootCards(opts: { stepDelayMs?: number; timeoutMs?: number } = {}): Promise<Kit> {
  const t = await setupTestDb();
  dbRef.db = t.db;
  // Only the card tables are cleared (no other module writes them); user rows are never truncated.
  await t.sql.unsafe(
    'truncate relay_orders, card_webhook_events, card_transactions, card_operations, cards, card_profiles restart identity cascade',
  );
  Object.assign(settings, {
    corsOrigins: [ORIGIN],
    allowedDomains: ['localhost:7000'],
    chainId: 4663,
    adminAddresses: [],
  });
  const app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  cardRoutes(app);
  cardWebhooks(app);
  const receiver = Bun.serve({ port: 0, fetch: (req) => app.fetch(req) });
  const mock = createMock({
    port: 0,
    apiKey: MOCK_KEY,
    apiSecret: MOCK_SECRET,
    webhookSecret: HOOK_SECRET,
    webhookUrl: `http://127.0.0.1:${receiver.port}/v1/webhooks/izipay`,
    stepDelayMs: opts.stepDelayMs ?? 30,
    otpDelayMs: 30,
    timeoutMs: opts.timeoutMs ?? 1500,
  });
  Object.assign(cardSettings, {
    mode: 'mock',
    liveWrites: false,
    baseUrl: `http://127.0.0.1:${mock.server.port}/api/v1`,
    apiKey: MOCK_KEY,
    apiSecret: MOCK_SECRET,
    webhookSecret: HOOK_SECRET,
    accountRef: `t${randomBytes(4).toString('hex')}`,
    encKey: randomBytes(32).toString('hex'),
    rateBudgetOverride: 1000,
    requestTimeoutMs: 600,
    nodeEnv: 'test',
    relayMode: 'live',
    maxOpsPerDay: 3,
    maxCentsPerDay: 200_000n,
    maxUnpaidInvoices: 1,
  });
  hooks.kick = async () => {};
  return {
    t,
    app,
    mock,
    receiver,
    newUser: () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as `0x${string}`,
    async as(address) {
      const s = await createTestSession(address);
      return {
        address,
        call: async (method, path, body, extra = {}) =>
          await app.request(path, {
            method,
            headers: { ...s.headers, origin: ORIGIN, 'content-type': 'application/json', ...extra },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
      };
    },
    async stop() {
      mock.stop();
      receiver.stop(true);
      await t.close();
    },
  };
}
