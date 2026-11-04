/**
 * Regression test for audit finding H-2: N payers share one balance, moving it on after each job, so every
 * settle fails. Their jobs must earn nothing in the next tree, and opens stop at the global cap.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { buyers, earningEvents, epochBalances, jobs, x402Payments } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { buildEpoch } from '../epochs/builder';
import { epochSettings } from '../epochs/service';
import { addressOverride } from './challenge';
import { chainDeps, enforceOpenIpCap, resetPayerCache, verifyAndOpen, x402Limits } from './verify';

const OWNER = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const NODE = crypto.randomUUID();
const CAP = 20_000_000n;
const EPOCH_S = 3600;
const hourAt = (h: number) => new Date((h * EPOCH_S + 600) * 1000);

let t: TestDb;
const origChain = { ...chainDeps };
const origLimits = { ...x402Limits };

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
  addressOverride.current = {
    usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    vault: '0x969aa7de33fdfdab7c11ade6a0288ec79f12fb19',
    permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
  };
  // every payer sees the one shared balance when opening: each moves it on after its jobs are served
  chainDeps.verifySignature = async () => true;
  chainDeps.nonceUsed = async () => false;
  chainDeps.payerState = async () => ({ balance: CAP, allowance: CAP });
});
afterAll(async () => {
  Object.assign(chainDeps, origChain);
  addressOverride.current = undefined;
  Object.assign(x402Limits, origLimits);
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  resetPayerCache();
  Object.assign(x402Limits, origLimits);
  epochSettings.treesDir = mkdtempSync(join(tmpdir(), 'trees-'));
});

const open = (payer: Address, cap = CAP) =>
  verifyAndOpen({
    scheme: 'exact',
    payer,
    paymentId: `0x${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')}` as Hex,
    cap,
    surcharge: 0n,
    nonce: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    validAfter: 0n,
    signature: '0x00',
    consume: async () => true,
  });
const fresh = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;

/** A served, receipted x402 job and the earning written for it at receipt time. */
async function earned(paymentId: string, payer: string, micros: bigint, at: Date) {
  const [b] = await t.db.insert(buyers).values({ address: payer }).onConflictDoNothing().returning();
  const jobId = crypto.randomUUID();
  await t.db.insert(jobs).values({
    id: jobId,
    buyerId: b?.id as string,
    lane: 'open',
    model: 'm',
    kind: 'chat',
    unitKind: 'tokens_1m',
    payMode: 'x402',
    x402PaymentId: paymentId,
    status: 'completed',
  });
  await t.db
    .insert(earningEvents)
    .values({ ts: at, nodeId: NODE, owner: OWNER, jobId, kind: 'job', usdgMicros: micros });
  return jobId;
}
const setStatus = (id: string, status: string) =>
  t.db.update(x402Payments).set({ status, usedMicros: 1_000_000n }).where(eq(x402Payments.id, id));
const refused = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof AppError ? e.message : String(e);
  }
};

test('H-2: N payers sharing one balance whose settles all fail earn 0 in the next tree', async () => {
  const N = 5;
  for (let i = 0; i < N; i++) {
    const payer = fresh();
    const { id } = await open(payer);
    await earned(id, payer, 800_000n, hourAt(100));
    await setStatus(id, 'failed');
  }
  const r = await buildEpoch(100n, { now: hourAt(101) });
  expect(r.kind).toBe('skipped'); // nothing payable, so no tree at all
  expect(await t.db.select().from(epochBalances)).toHaveLength(0);
  const events = await t.db.select().from(earningEvents);
  expect(events.filter((e) => e.kind === 'x402_reversal')).toHaveLength(N);
  expect(events.reduce((a, e) => a + e.usdgMicros, 0n)).toBe(0n);
});

test('H-2: opens are refused past the global cap, however many addresses are used', async () => {
  x402Limits.maxGlobalUnsettled = 3n * CAP;
  for (let i = 0; i < 3; i++) await open(fresh());
  expect(await refused(open(fresh()))).toContain('at capacity');
  expect(await t.db.select().from(x402Payments)).toHaveLength(3);
  // it is exposure that counts: once a payment settles there is room again
  const [first] = await t.db.select().from(x402Payments);
  await setStatus(first?.id as string, 'settled');
  expect(await refused(open(fresh()))).toBeNull();
});

test('the global cap holds under concurrent opens', async () => {
  x402Limits.maxGlobalUnsettled = 3n * CAP;
  const results = await Promise.all(Array.from({ length: 10 }, () => refused(open(fresh()))));
  expect(results.filter((r) => r === null)).toHaveLength(3);
  expect(await t.db.select().from(x402Payments)).toHaveLength(3);
});

test('a settled payment pays out, in the first tree after it settles', async () => {
  const payer = fresh();
  const { id } = await open(payer);
  await earned(id, payer, 800_000n, hourAt(100));
  // still unsettled at the first build: held back
  expect((await buildEpoch(100n, { now: hourAt(101) })).kind).toBe('skipped');
  const [held] = await t.db.select().from(earningEvents);
  expect(held?.epoch).toBeNull();
  await setStatus(id, 'settled');
  const r = await buildEpoch(101n, { now: hourAt(102) });
  expect(r.kind === 'built' && r.totalEarned).toBe(800_000n);
});

test('a reversal keeps its earning timestamp, so the pair lands in one epoch and nets to zero', async () => {
  const bad = fresh();
  const good = fresh();
  const failed = await open(bad);
  const paid = await open(good);
  await earned(failed.id, bad, 800_000n, hourAt(100));
  await earned(paid.id, good, 500_000n, hourAt(100));
  await setStatus(failed.id, 'expired');
  await setStatus(paid.id, 'settled');
  const r = await buildEpoch(100n, { now: hourAt(101) });
  expect(r.kind === 'built' && r.totalEarned).toBe(500_000n);
  const events = await t.db.select().from(earningEvents);
  expect(events.every((e) => e.epoch === 100n)).toBe(true);
  // building again reverses nothing twice
  await buildEpoch(101n, { now: hourAt(102) });
  const reversals = (await t.db.select().from(earningEvents)).filter((e) => e.kind === 'x402_reversal');
  expect(reversals).toHaveLength(1);
});

test('earnings from balance-paid jobs are unaffected', async () => {
  await t.db
    .insert(earningEvents)
    .values({ ts: hourAt(100), nodeId: NODE, owner: OWNER, kind: 'job', usdgMicros: 900_000n });
  const r = await buildEpoch(100n, { now: hourAt(101) });
  expect(r.kind === 'built' && r.totalEarned).toBe(900_000n);
});

test('per-IP cap on opens', async () => {
  x402Limits.maxOpensPerIpDay = 2;
  const headers: Record<string, string> = { 'cf-connecting-ip': `test-${crypto.randomUUID()}` };
  const c = {
    req: { header: (n: string) => headers[n] },
    header: () => {},
  } as unknown as Context<Env>;
  await enforceOpenIpCap(c);
  await enforceOpenIpCap(c);
  expect(await refused(enforceOpenIpCap(c))).toContain('Too many x402 payments');
});
