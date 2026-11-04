import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { credit } from '../../db/balances';
import {
  buyerBalances,
  buyerLedger,
  earningEvents,
  jobs,
  nodes,
  rateCard,
  receipts,
  users,
} from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { canonicalJson, sha256Hex } from '../../shared/canonical-json';
import type { GatewayView } from '../../shared/contracts/jobs';
import { outputDigest, type ReceiptPayload, receiptToBase64, signReceipt } from '../../shared/receipt';
import { dbRef } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { buyerIdForAddress, reserve } from '../buyers/service';
import { canaryHooks } from '../canary/hooks';
import { utcDay } from '../gateway/pricing';
import {
  type GatewayRequest,
  insertJob,
  resetJobFinishedHandler,
  reverseCharge,
  settleJob,
} from '../gateway/service';
import receiptRoutes from './routes';
import { billedUsage, onJobFinished, receiptSettings } from './service';

let t: TestDb;
const nodePk = generatePrivateKey();
const nodeAcct = privateKeyToAccount(nodePk);
const OWNER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const BUYER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
let ownerUserId: string;
let buyerId: string;
let nodeId: string;
const request = { model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }] };
let RESERVE = 10_000n;
const defaultCanaryHook = canaryHooks.onCanaryFinished;

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
});
afterAll(async () => {
  // this module object is shared by every test file in the bun process: leave it as it was found
  canaryHooks.onCanaryFinished = defaultCanaryHook;
  await t.close();
  await closeRedis();
});
afterEach(() => {
  receiptSettings.chargeOnFailure = false;
});
beforeEach(async () => {
  await t.reset();
  resetJobFinishedHandler();
  canaryHooks.onCanaryFinished = async () => {};
  RESERVE = 10_000n;
  const [u] = await t.db.insert(users).values({ address: OWNER }).returning();
  ownerUserId = u?.id as string;
  buyerId = await buyerIdForAddress(BUYER);
  await credit(t.db, { buyerId, micros: 1_000_000n, txHash: `0x${'1'.repeat(64)}`, logIndex: 0 });
  const [n] = await t.db
    .insert(nodes)
    .values({
      owner: OWNER,
      userId: ownerUserId,
      nodeKey: nodeAcct.address.toLowerCase(),
      nodePubkey: nodeAcct.publicKey,
      name: 'rig',
      engine: 'ollama',
      gpuModel: 'RTX 4090',
      gpuClass: 2,
      lane: 'open',
      status: 'online',
      registered: true,
      onchainId: 7n,
    })
    .returning();
  nodeId = n?.id as string;
  await t.db.insert(rateCard).values(
    (
      [
        ['tokens_1m', 1_000_000n, 800_000n],
        ['image', 40_000n, 32_000n],
      ] as const
    ).map(([unitKind, b, p]) => ({
      day: utcDay(),
      gpuClass: 2,
      lane: 'open',
      unitKind,
      buyerUsdgMicrosPerUnit: b,
      providerUsdgMicrosPerUnit: p,
    })),
  );
});

/** A completed job with a live reservation, like the gateway leaves it before calling the hook. */
async function newJob(opts: { canary?: boolean; kind?: 'chat' | 'embeddings' | 'images' } = {}) {
  const jobId = crypto.randomUUID();
  const kind = opts.kind ?? 'chat';
  await reserve(buyerId, RESERVE);
  await insertJob({
    jobId,
    req: { kind, model: { id: 'qwen2.5:7b' }, lane: 'open' } as unknown as GatewayRequest,
    auth: { provider: 'balance', payMode: 'balance', buyerId, jobId, reservedMicros: RESERVE },
    rates: new Map(),
  });
  await t.db
    .update(jobs)
    .set({
      status: 'completed',
      nodeId,
      finishedAt: new Date(),
      isCanary: opts.canary ?? false,
      ...(opts.canary ? { payMode: 'canary' } : {}),
    })
    .where(eq(jobs.id, jobId));
  return jobId;
}

const payload = (jobId: string, over: Partial<ReceiptPayload> = {}): ReceiptPayload => ({
  v: 1,
  jobId,
  nodeKey: nodeAcct.address,
  model: 'qwen2.5:7b',
  modelDigest: 'sha256:x',
  kind: 'chat',
  lane: 'open',
  usage: { p: 7, c: 100 },
  inputDigest: sha256Hex(canonicalJson(request)),
  outputDigest: outputDigest('chat', 'hello'),
  startedAt: 1,
  finishedAt: 2,
  agentVersion: '0.1.0',
  ...over,
});
const view = (over: Partial<GatewayView> = {}): GatewayView => ({
  outputText: 'hello',
  inputDigest: sha256Hex(canonicalJson(request)),
  recount: { promptTokens: 7, completionTokens: 100 },
  recountEstimated: false,
  ...over,
});
const done = (jobId: string, p: ReceiptPayload = payload(jobId)) =>
  ({
    v: 1 as const,
    type: 'job.done' as const,
    jobId,
    output: {},
    usage: { promptTokens: p.usage.p, completionTokens: p.usage.c },
    receipt: receiptToBase64(signReceipt(p, nodePk)),
  }) as Parameters<typeof onJobFinished>[1];

const balance = async () => {
  const [b] = await t.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, buyerId));
  return { balance: b?.balanceUsdgMicros ?? 0n, reserved: b?.reservedUsdgMicros ?? 0n };
};
const charges = () => t.db.select().from(buyerLedger).where(eq(buyerLedger.kind, 'charge'));
const rep = async () => (await t.db.select().from(nodes).where(eq(nodes.id, nodeId)))[0]?.reputation;

describe('onJobFinished: verified', () => {
  test('charges verified units x buyer rate, pays floor(80%) to the owner', async () => {
    const id = await newJob();
    await onJobFinished(id, done(id), view());
    // 107 tokens at 1_000_000 micros / 1M = 107 micros; provider floor(107 * 0.8) = 85
    expect(await balance()).toEqual({ balance: 1_000_000n - 107n, reserved: 0n });
    const [job] = await t.db.select().from(jobs).where(eq(jobs.id, id));
    expect(job).toMatchObject({
      buyerUsdgMicros: 107n,
      providerUsdgMicros: 85n,
      promptTokens: 7,
      completionTokens: 100,
    });
    expect(Number(job?.units)).toBe(107);
    const ev = await t.db.select().from(earningEvents);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ owner: OWNER, nodeId, jobId: id, kind: 'job', usdgMicros: 85n });
    const [r] = await t.db.select().from(receipts).where(eq(receipts.jobId, id));
    expect(r).toMatchObject({ verified: true, reason: null, recountTokens: 100, nodeId });
    expect(await rep()).toBe(1001);
  });

  test('charge never exceeds the reservation', async () => {
    const id = await newJob();
    const p = payload(id, { usage: { p: 7, c: 50_000_000 } });
    await onJobFinished(
      id,
      done(id, p),
      view({ recount: { promptTokens: 7, completionTokens: 50_000_000 } }),
    );
    expect(await balance()).toEqual({ balance: 1_000_000n - RESERVE, reserved: 0n });
    expect((await t.db.select().from(earningEvents))[0]?.usdgMicros).toBe(8000n);
  });

  test('is idempotent, also under concurrent calls', async () => {
    const id = await newJob();
    await Promise.all([1, 2, 3].map(() => onJobFinished(id, done(id), view())));
    await onJobFinished(id, done(id), view());
    expect(await t.db.select().from(earningEvents)).toHaveLength(1);
    expect(await charges()).toHaveLength(1);
    expect(await t.db.select().from(receipts)).toHaveLength(1);
    expect((await balance()).balance).toBe(1_000_000n - 107n);
    expect(await rep()).toBe(1001);
  });

  test('estimated recount: bills the lower of node and gateway', async () => {
    const id = await newJob();
    const p = payload(id, { usage: { p: 7, c: 100 } });
    await onJobFinished(
      id,
      done(id, p),
      view({ recountEstimated: true, recount: { promptTokens: 9, completionTokens: 60 } }),
    );
    expect((await t.db.select().from(receipts))[0]?.verified).toBe(true);
    expect((await t.db.select().from(jobs))[0]?.buyerUsdgMicros).toBe(67n); // 7 + 60
  });

  test('images are billed per image', async () => {
    RESERVE = 100_000n;
    const id = await newJob({ kind: 'images' });
    const imgs = [new Uint8Array([1]), new Uint8Array([2])];
    const p = payload(id, {
      kind: 'images',
      usage: { p: 0, c: 0, n: 2 },
      outputDigest: outputDigest('images', imgs),
    });
    await onJobFinished(id, done(id, p), view({ outputText: undefined, recount: undefined, images: imgs }));
    expect((await t.db.select().from(jobs))[0]).toMatchObject({
      buyerUsdgMicros: 80_000n,
      providerUsdgMicros: 64_000n,
    });
  });
});

describe('onJobFinished: failures', () => {
  test('tampered receipt: buyer is not charged, no earnings, reputation -25', async () => {
    const id = await newJob();
    const p = payload(id, { usage: { p: 7, c: 9999 }, inputDigest: 'f'.repeat(64) });
    await onJobFinished(id, done(id, p), view());
    const [r] = await t.db.select().from(receipts);
    expect(r).toMatchObject({ verified: false, reason: 'INPUT_DIGEST' });
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
    expect((await t.db.select().from(jobs))[0]).toMatchObject({
      buyerUsdgMicros: 0n,
      providerUsdgMicros: 0n,
    });
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect(await charges()).toHaveLength(0);
    expect(await rep()).toBe(975);
  });

  test('TOKEN_MISMATCH (node saw a truncated prompt): provider earns 0 and the buyer pays nothing', async () => {
    const id = await newJob();
    // gateway counts 4465 prompt tokens, the node signed 4085
    const p = payload(id, { usage: { p: 4085, c: 100 } });
    await onJobFinished(id, done(id, p), view({ recount: { promptTokens: 4465, completionTokens: 100 } }));
    expect((await t.db.select().from(receipts))[0]).toMatchObject({
      verified: false,
      reason: 'TOKEN_MISMATCH',
    });
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect((await t.db.select().from(jobs))[0]).toMatchObject({
      buyerUsdgMicros: 0n,
      providerUsdgMicros: 0n,
    });
  });

  test('a charge already applied (reconciler settled it) is reversed with a refund ledger row, once', async () => {
    const id = await newJob();
    expect(await settleJob(id, 500n)).toBe(500n);
    expect(await balance()).toEqual({ balance: 1_000_000n - 500n, reserved: 0n });
    const p = payload(id, { usage: { p: 4085, c: 100 } });
    const v = view({ recount: { promptTokens: 4465, completionTokens: 100 } });
    await onJobFinished(id, done(id, p), v);
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    const ledger = await t.db.select().from(buyerLedger).where(eq(buyerLedger.jobId, id));
    expect(ledger.map((l) => [l.kind, l.usdgMicros])).toEqual([
      ['charge', -500n],
      ['refund', 500n],
    ]);
    expect(await reverseCharge(id)).toBe(0n); // nothing left to reverse
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
  });

  test('chargeOnFailure=true restores the old behaviour (bills the gateway recount)', async () => {
    receiptSettings.chargeOnFailure = true;
    const id = await newJob();
    await onJobFinished(id, done(id, payload(id, { model: 'other' })), view());
    expect(await balance()).toEqual({ balance: 1_000_000n - 107n, reserved: 0n });
  });

  test('failed receipt releases without charging', async () => {
    const id = await newJob();
    await onJobFinished(id, done(id, payload(id, { model: 'other' })), view());
    expect((await t.db.select().from(receipts))[0]?.reason).toBe('FIELD_MISMATCH');
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect(await charges()).toHaveLength(0);
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
  });

  test('unparseable receipt is stored and rejected', async () => {
    const id = await newJob();
    const d = { ...done(id), receipt: '!!!not base64!!!' };
    await onJobFinished(id, d, view());
    expect((await t.db.select().from(receipts))[0]).toMatchObject({
      verified: false,
      reason: 'BAD_SIGNATURE',
    });
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
  });

  test('reputation is clamped to 0..2000', async () => {
    await t.db.update(nodes).set({ reputation: 10 }).where(eq(nodes.id, nodeId));
    const a = await newJob();
    await onJobFinished(a, done(a, payload(a, { model: 'x' })), view());
    expect(await rep()).toBe(0);
    await t.db.update(nodes).set({ reputation: 2000 }).where(eq(nodes.id, nodeId));
    const b = await newJob();
    await onJobFinished(b, done(b), view());
    expect(await rep()).toBe(2000);
  });

  test('job that is not completed is released, not charged', async () => {
    const id = await newJob();
    await t.db.update(jobs).set({ status: 'timeout' }).where(eq(jobs.id, id));
    await onJobFinished(id, done(id), view());
    expect(await t.db.select().from(receipts)).toHaveLength(0);
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
  });
});

describe('onJobFinished: canary', () => {
  test('no charge, no earnings, no reputation change; forwarded to the canary hook', async () => {
    const seen: unknown[] = [];
    canaryHooks.onCanaryFinished = async (e) => void seen.push(e);
    const id = await newJob({ canary: true });
    await onJobFinished(id, done(id), view());
    expect(await balance()).toEqual({ balance: 1_000_000n, reserved: 0n });
    expect(await t.db.select().from(earningEvents)).toHaveLength(0);
    expect((await t.db.select().from(receipts))[0]?.verified).toBe(true);
    expect(await rep()).toBe(1000);
    expect(seen).toEqual([
      { jobId: id, nodeId, verified: true, reason: null, outputText: 'hello', embeddings: undefined },
    ]);
  });
});

describe('billedUsage', () => {
  const node = { p: 10, c: 100, n: 0 };
  test('within tolerance bills the recount; outside, the lower value; failure, the recount', () => {
    const v = view({ recount: { promptTokens: 10, completionTokens: 101 } });
    expect(billedUsage('chat', node, v, true)?.units).toBe(111);
    expect(billedUsage('chat', { ...node, c: 500 }, v, true)?.units).toBe(111);
    expect(billedUsage('chat', { ...node, c: 50 }, v, true)?.units).toBe(60);
    expect(billedUsage('chat', { ...node, c: 500 }, v, false)?.units).toBe(111);
    expect(billedUsage('chat', node, view({ recount: undefined }), true)?.units).toBe(110);
    expect(billedUsage('chat', node, view({ recount: undefined }), false)).toBeNull();
  });
});

describe('routes', () => {
  const app = new Hono<Env>();
  app.onError(jsonError);
  authRoutes(app);
  receiptRoutes(app);

  test('public receipt, owner/buyer app views, stranger gets 404', async () => {
    const id = await newJob();
    await onJobFinished(id, done(id), view());
    const pub = await app.request(`/v1/receipts/${id}`);
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      jobId: id,
      nodeId,
      onchainNodeId: '7',
      nodePubkey: nodeAcct.publicKey,
      owner: OWNER,
      verified: true,
      reason: null,
      epoch: null,
      usage: { p: 7, c: 100 },
    });
    expect(typeof body.cose).toBe('string');
    expect((await app.request(`/v1/receipts/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await app.request('/v1/receipts/nope')).status).toBe(404);

    const owner = await createTestSession(OWNER);
    const asOwner = await app.request(`/v1/app/receipts/${id}`, { headers: owner.headers });
    expect(((await asOwner.json()) as { earning: unknown }).earning).toEqual({
      providerMicros: '85',
      epoch: null,
    });
    const buyer = await createTestSession(BUYER);
    const asBuyer = await app.request(`/v1/app/receipts/${id}`, { headers: buyer.headers });
    expect(((await asBuyer.json()) as { earning: unknown }).earning).toBeNull();
    const stranger = await createTestSession(privateKeyToAccount(generatePrivateKey()).address);
    expect((await app.request(`/v1/app/receipts/${id}`, { headers: stranger.headers })).status).toBe(404);
    expect((await app.request(`/v1/app/receipts/${id}`)).status).toBe(401);

    const list = (await (
      await app.request('/v1/app/receipts?lane=open&q=qwen', { headers: owner.headers })
    ).json()) as {
      items: { jobId: string; nodeName: string; verified: boolean; providerMicros: string }[];
      nextCursor: string | null;
    };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ jobId: id, nodeName: 'rig', verified: true, providerMicros: '85' });
    const none = (await (await app.request('/v1/app/receipts', { headers: stranger.headers })).json()) as {
      items: unknown[];
    };
    expect(none.items).toHaveLength(0);
  });

  test('receipts list paginates', async () => {
    for (let i = 0; i < 3; i++) {
      const id = await newJob();
      await onJobFinished(id, done(id), view());
    }
    const owner = await createTestSession(OWNER);
    const p1 = (await (await app.request('/v1/app/receipts?limit=2', { headers: owner.headers })).json()) as {
      items: { jobId: string }[];
      nextCursor: string;
    };
    expect(p1.items).toHaveLength(2);
    const p2 = (await (
      await app.request(`/v1/app/receipts?limit=2&cursor=${p1.nextCursor}`, { headers: owner.headers })
    ).json()) as { items: { jobId: string }[]; nextCursor: string | null };
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((i) => i.jobId)).size).toBe(3);
  });

  test('GET /v1/rate-card lists today (seeds on first boot)', async () => {
    const res = await app.request('/v1/rate-card');
    const rows = (await res.json()) as { gpuClass: number; unitKind: string; buyerMicrosPerUnit: string }[];
    expect(rows.find((r) => r.gpuClass === 2 && r.unitKind === 'tokens_1m')?.buyerMicrosPerUnit).toBe(
      '1000000',
    );
  });
});

describe('already settled by the reaper', () => {
  test('keeps the provisional charge instead of overwriting it with 0', async () => {
    const { settleJob } = await import('../gateway/service');
    const id = await newJob();
    await t.db.update(jobs).set({ buyerUsdgMicros: 107n }).where(eq(jobs.id, id));
    await settleJob(id, 107n); // reaper path settled first
    await onJobFinished(id, done(id), view());
    expect((await t.db.select().from(jobs))[0]?.buyerUsdgMicros).toBe(107n);
    expect(await charges()).toHaveLength(1);
  });
});
