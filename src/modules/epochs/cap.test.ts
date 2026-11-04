/**
 * Regression test for audit finding M-2 (PoC chain/zz_poc_cap): once unposted earnings exceeded
 * maxEpochIncrease every later epoch was over the cap too, and payouts froze for good.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spindleClaimsAbi } from '@spindle/shared/abi';
import { eq } from 'drizzle-orm';
import { decodeFunctionData, type Hex } from 'viem';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { auditLog, earningEvents, epochs } from '../../db/schema';
import { closeRedis, getRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import { buildEpoch } from './builder';
import { ATTEMPT_KEY, LOCK_KEY, runEpochOnce } from './jobs';
import { buildHeadroom, type OnchainRoot, type PosterDeps, postPending } from './poster';
import { epochSettings } from './service';

let t: TestDb;
const S = 3600;
const A = '0x00000000000000000000000000000000000000aa';
const B = '0x00000000000000000000000000000000000000bb';
const NODE = '00000000-0000-4000-8000-000000000001';
const USDG = 1_000_000n;
const CAP = 5_000n * USDG; // Deploy.s.sol default
/** The closed hour `h` is built at minute 10 of hour h + 1. */
const at = (h: number) => new Date((h * S + 600) * 1000);

/** A chain that enforces the cap like SpindleClaims.postRoot. */
let posted: Map<bigint, OnchainRoot>;
let lastEpoch: bigint;
let sent: bigint[];
const deps = (): PosterDeps => ({
  claims: '0x0000000000000000000000000000000000000c1a',
  criticalEthWei: 0n,
  now: () => new Date(),
  send: async ({ data }) => {
    const { args } = decodeFunctionData({ abi: spindleClaimsAbi, data: data as Hex });
    const [epoch, root, total] = args as readonly [bigint, Hex, bigint];
    const prev = posted.get(lastEpoch)?.totalEarned ?? 0n;
    if (total - prev > CAP) throw new Error('chain would revert: over cap');
    posted.set(epoch, { root, totalEarned: total, postedAt: 1n });
    lastEpoch = epoch;
    sent.push(total);
    return { hash: '0x01' as Hex, status: 'success', gasUsed: 1n, effectiveGasPrice: 1n };
  },
  chain: {
    maxPostedEpoch: async () => lastEpoch,
    lastEpoch: async () => lastEpoch,
    root: async (e) => posted.get(e) ?? { root: '0x00' as Hex, totalEarned: 0n, postedAt: 0n },
    maxEpochIncrease: async () => CAP,
    poolBalance: async () => 10n ** 15n,
    totalClaimed: async () => 0n,
    keeperEth: async () => 10n ** 18n,
    receiptStatus: async () => null,
  },
});

beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
});
afterAll(async () => {
  await t.close();
  await closeRedis();
});
beforeEach(async () => {
  await t.reset();
  await getRedis().del(LOCK_KEY);
  epochSettings.treesDir = mkdtempSync(join(tmpdir(), 'trees-'));
  posted = new Map();
  lastEpoch = 0n;
  sent = [];
});

const earn = (h: number, micros: bigint, owner = A) =>
  t.db.insert(earningEvents).values({ ts: at(h - 1), nodeId: NODE, owner, kind: 'job', usdgMicros: micros });

test('control: under the cap the epoch posts in one go', async () => {
  await earn(100, 4_000n * USDG);
  await runEpochOnce(at(100), deps());
  expect(sent).toEqual([4_000n * USDG]);
});

test('M-2: a backlog over the cap converges in steps, with every step accepted by the chain', async () => {
  await earn(100, 12_001n * USDG);
  for (let h = 100; h < 104; h++) await runEpochOnce(at(h), deps());
  expect(sent).toEqual([5_000n * USDG, 10_000n * USDG, 12_001n * USDG]);
});

test('M-2: growth while stepping is paid too, and owners all get paid in the end', async () => {
  await earn(100, 7_000n * USDG, A);
  await earn(100, 2_000n * USDG, B);
  for (let h = 101; h < 105; h++) {
    await earn(h, 1_000n * USDG, B);
    await runEpochOnce(at(h - 1), deps());
  }
  await runEpochOnce(at(104), deps());
  await runEpochOnce(at(105), deps());
  expect(sent.at(-1)).toBe(13_000n * USDG);
  for (let i = 1; i < sent.length; i++) {
    expect((sent[i] as bigint) - (sent[i - 1] as bigint)).toBeLessThanOrEqual(CAP);
  }
});

test('M-2: the PoC state (an oversized epoch that already failed) recovers', async () => {
  await earn(100, 5_001n * USDG);
  await buildEpoch(100n, { now: at(100) });
  const failed = await postPending(deps());
  expect(failed.kind === 'failed' && failed.reason).toContain('maxEpochIncrease');
  for (let h = 101; h < 104; h++) await runEpochOnce(at(h), deps());
  expect(sent).toEqual([5_000n * USDG, 5_001n * USDG]);
  const [old] = await t.db.select().from(epochs).where(eq(epochs.epoch, 100n));
  expect(old?.status).toBe('vetoed');
  const logs = await t.db.select().from(auditLog).where(eq(auditLog.action, 'epoch.retired'));
  expect(logs).toHaveLength(1);
});

test('headroom counts built but unposted epochs, so roots behind a blocked post still fit', async () => {
  await earn(100, 3_000n * USDG);
  await buildEpoch(100n, { now: at(100) }); // built, not posted (say, keeper out of ETH)
  // limit is 0 + 5000; the unposted base already uses 3000 of it
  expect(await buildHeadroom(deps())).toBe(2_000n * USDG);
});

test('no room left: nothing is built, and the pending root is what gets retried', async () => {
  await earn(100, 5_000n * USDG);
  await buildEpoch(100n, { now: at(100) });
  await earn(101, 10n * USDG);
  expect(await buildHeadroom(deps())).toBe(0n);
  const r = await buildEpoch(101n, { now: at(101), maxIncrease: 0n });
  expect(r).toEqual({ kind: 'skipped', reason: 'unchanged' });
  await postPending(deps());
  expect(sent).toEqual([5_000n * USDG]);
});

test('a chain read failure builds nothing and retries the next minute', async () => {
  const d = deps();
  d.chain.maxEpochIncrease = async () => {
    throw new Error('rpc down');
  };
  await earn(100, 10n * USDG);
  const out = await runEpochOnce(at(100), d);
  expect(out.build).toBeUndefined();
  expect(await t.db.select().from(epochs)).toHaveLength(0);
  const kvRows = await t.sql`select 1 from kv where key = ${ATTEMPT_KEY}`;
  expect(kvRows).toHaveLength(0);
});
