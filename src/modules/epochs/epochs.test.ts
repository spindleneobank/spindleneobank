import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { auditLog, earningEvents, epochBalances, epochs, kv } from '../../db/schema';
import { type Env, jsonError } from '../../lib/http';
import type { KeeperTxInput, KeeperTxResult } from '../../lib/keeper';
import { closeRedis } from '../../lib/redis';
import { leafFor, treeFromJson } from '../../shared/merkle';
import { dbRef } from '../auth/constants';
import { buildEpoch, nextEpochNumber } from './builder';
import { jsonSafe } from './jobs';
import {
  ALERT_KEY,
  type OnchainRoot,
  POSTING_STALE_MS,
  type PosterChain,
  type PosterDeps,
  postEpoch,
  postingKey,
  postPending,
} from './poster';
import epochRoutes from './routes';
import { epochSettings, listEpochs, waitingFor } from './service';

let t: TestDb;
const addr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Hex;
const A = addr();
const B = addr();
const C = addr();
const NODE = '00000000-0000-4000-8000-000000000001';
const S = 3600;
// Epoch 100 closes at (101)*3600.
const NOW = new Date((101 * S + 600) * 1000);
const inHour = (h: number, min = 10) => new Date((h * S + min * 60) * 1000);

const ev = (owner: string, ts: Date, usdgMicros: bigint, kind = 'job') =>
  ({ ts, nodeId: NODE, owner, kind, usdgMicros }) as typeof earningEvents.$inferInsert;

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
  epochSettings.treesDir = mkdtempSync(join(tmpdir(), 'trees-'));
});

const bal = async (epoch: bigint) =>
  Object.fromEntries(
    (await t.db.select().from(epochBalances).where(eq(epochBalances.epoch, epoch))).map((r) => [
      r.owner,
      r.cumulativeUsdgMicros,
    ]),
  );

describe('builder', () => {
  test('numbers the closed hour, assigns events, writes a tree whose leaves match the contract hash', async () => {
    await t.db.insert(earningEvents).values([
      ev(A, inHour(100), 700n),
      ev(A, inHour(100, 40), 300n),
      ev(B, inHour(100), 50n),
      ev(C, inHour(101), 999n), // current hour, not included
    ]);
    expect(await nextEpochNumber(NOW)).toBe(100n);
    const r = await buildEpoch(100n, { now: NOW });
    expect(r.kind).toBe('built');
    expect(await bal(100n)).toEqual({ [A]: 1000n, [B]: 50n });
    const [row] = await t.db.select().from(epochs);
    expect(row?.status).toBe('built');
    expect(row?.totalEarnedUsdgMicros).toBe(1050n);
    expect(row?.owners).toBe(2);
    expect(readdirSync(epochSettings.treesDir)).toEqual(['100.json']); // no tmp leftovers
    const tree = treeFromJson(JSON.parse(readFileSync(join(epochSettings.treesDir, '100.json'), 'utf8')));
    expect(tree.root).toBe(row?.root as Hex);
    expect(tree.leafHash([A, '1000'])).toBe(leafFor(A, 1000n));
    const assigned = await t.db.select().from(earningEvents).where(eq(earningEvents.epoch, 100n));
    expect(assigned).toHaveLength(3);
  });

  test('idempotent: second run returns the same row and creates no duplicates', async () => {
    await t.db.insert(earningEvents).values([ev(A, inHour(100), 5n)]);
    const r1 = await buildEpoch(100n, { now: NOW });
    const r2 = await buildEpoch(100n, { now: NOW });
    expect(r2.kind).toBe('exists');
    if (r1.kind === 'built' && r2.kind === 'exists') expect(r2.row.root).toBe(r1.root);
    expect(await t.db.select().from(epochs)).toHaveLength(1);
    expect(await t.db.select().from(epochBalances)).toHaveLength(1);
  });

  test('carry-forward of unchanged owners and accumulation', async () => {
    await t.db.insert(earningEvents).values([ev(A, inHour(100), 100n), ev(B, inHour(100), 40n)]);
    await buildEpoch(100n, { now: NOW });
    const later = new Date(NOW.getTime() + S * 1000);
    await t.db.insert(earningEvents).values([ev(A, inHour(101), 25n)]);
    const r = await buildEpoch(101n, { now: later });
    expect(r.kind).toBe('built');
    expect(await bal(101n)).toEqual({ [A]: 125n, [B]: 40n });
  });

  test('negative net sum never lowers the cumulative; the penalty is absorbed by later earnings', async () => {
    await t.db.insert(earningEvents).values([ev(A, inHour(100), 100n), ev(B, inHour(100), 10n)]);
    await buildEpoch(100n, { now: NOW });
    const h1 = new Date(NOW.getTime() + S * 1000);
    await t.db.insert(earningEvents).values([ev(A, inHour(101), -60n, 'slash'), ev(B, inHour(101), 5n)]);
    await buildEpoch(101n, { now: h1 });
    // A: true sum 40 < prev 100 -> held at 100
    expect(await bal(101n)).toEqual({ [A]: 100n, [B]: 15n });
    const h2 = new Date(h1.getTime() + S * 1000);
    await t.db.insert(earningEvents).values([ev(A, inHour(102), 30n)]);
    // true sum 70 still below 100 -> nothing changed, no epoch
    expect((await buildEpoch(102n, { now: h2 })).kind).toBe('skipped');
    const h3 = new Date(h2.getTime() + S * 1000);
    await t.db.insert(earningEvents).values([ev(A, inHour(103), 50n)]);
    await buildEpoch(102n, { now: h3 });
    // true sum 120
    expect((await bal(102n))[A]).toBe(120n);
  });

  test('skips when nothing changed (no row, events stay unassigned)', async () => {
    await t.db.insert(earningEvents).values([ev(A, inHour(100), 100n)]);
    await buildEpoch(100n, { now: NOW });
    const later = new Date(NOW.getTime() + S * 1000);
    const r = await buildEpoch(101n, { now: later });
    expect(r).toEqual({ kind: 'skipped', reason: 'unchanged' });
    expect(await t.db.select().from(epochs)).toHaveLength(1);
    // net-negative only: also unchanged and the event is not marked as included
    await t.db.insert(earningEvents).values([ev(A, inHour(101), -5n, 'slash')]);
    const r2 = await buildEpoch(101n, { now: later });
    expect(r2.kind).toBe('skipped');
    const open = await t.db.select().from(earningEvents).where(eq(earningEvents.kind, 'slash'));
    expect(open[0]?.epoch).toBeNull();
  });

  test('no owners -> skipped', async () => {
    expect((await buildEpoch(100n, { now: NOW })).kind).toBe('skipped');
  });

  test('maxIncrease splits the delta in steps (owner order), totals stay monotone', async () => {
    await t.db.insert(earningEvents).values([ev(A, inHour(100), 100n), ev(B, inHour(100), 100n)]);
    const sorted = [A, B].sort();
    await buildEpoch(100n, { now: NOW, maxIncrease: 150n });
    const b1 = await bal(100n);
    expect(b1[sorted[0] as string]).toBe(100n);
    expect(b1[sorted[1] as string]).toBe(50n);
    const later = new Date(NOW.getTime() + S * 1000);
    await buildEpoch(101n, { now: later, maxIncrease: 150n });
    expect(await bal(101n)).toEqual({ [A]: 100n, [B]: 100n });
  });

  test('veto: events return to the pool and a higher epoch number is rebuilt from the last good root', async () => {
    await t.db.insert(earningEvents).values([ev(A, inHour(100), 100n)]);
    await buildEpoch(100n, { now: NOW });
    await t.db.update(epochs).set({ status: 'posted', postedAt: NOW }).where(eq(epochs.epoch, 100n));
    const h1 = new Date(NOW.getTime() + S * 1000);
    await t.db.insert(earningEvents).values([ev(A, inHour(101), 40n), ev(B, inHour(101), 7n)]);
    await buildEpoch(101n, { now: h1 });
    await t.db.update(epochs).set({ status: 'vetoed' }).where(eq(epochs.epoch, 101n));
    // closed hour is still 101 -> rebuild must use 102
    expect(await nextEpochNumber(h1)).toBe(102n);
    const r = await buildEpoch(102n, { now: h1 });
    expect(r.kind).toBe('built');
    expect(await bal(102n)).toEqual({ [A]: 140n, [B]: 7n });
    const v = await t.db.select().from(earningEvents).where(eq(earningEvents.epoch, 101n));
    expect(v).toHaveLength(0);
    // the following hour (closed = 102) continues at 103: the post-veto rebuild does not block it
    expect(await nextEpochNumber(new Date(h1.getTime() + S * 1000))).toBe(103n);
    // second run is a no-op
    expect((await buildEpoch(102n, { now: h1 })).kind).toBe('exists');
  });
});

// ---------------------------------------------------------------- poster

const CLAIMS = '0x00000000000000000000000000000000000000c1' as const;
const ROOT = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;

function mkChain(over: Partial<Record<keyof PosterChain, unknown>> = {}) {
  const roots = new Map<bigint, OnchainRoot>();
  const chain: PosterChain = {
    maxPostedEpoch: async () => 0n,
    lastEpoch: async () => 0n,
    root: async (e) => roots.get(e) ?? { root: ROOT(0), totalEarned: 0n, postedAt: 0n },
    maxEpochIncrease: async () => 5_000_000_000n,
    poolBalance: async () => 10_000_000_000n,
    totalClaimed: async () => 0n,
    keeperEth: async () => 10n ** 18n,
    receiptStatus: async () => null,
    ...(over as Partial<PosterChain>),
  };
  return { chain, roots };
}
function mkDeps(chain: PosterChain, send?: (i: KeeperTxInput) => Promise<KeeperTxResult>) {
  const sent: KeeperTxInput[] = [];
  const deps: PosterDeps = {
    chain,
    claims: CLAIMS,
    criticalEthWei: 1000n,
    now: () => NOW,
    send:
      send ??
      (async (i) => {
        sent.push(i);
        return { hash: ROOT(0xabc), status: 'success', gasUsed: 90_000n, effectiveGasPrice: 1n };
      }),
  };
  return { deps, sent };
}
async function built(total = 1_000_000n) {
  await t.db.insert(earningEvents).values([ev(A, inHour(100), total)]);
  await buildEpoch(100n, { now: NOW });
}
const status = async () => (await t.db.select().from(epochs))[0]?.status;

describe('poster', () => {
  test('happy path sends postRoot(epoch, root, total) and marks posted', async () => {
    await built();
    const { chain } = mkChain();
    const { deps, sent } = mkDeps(chain);
    const out = await postEpoch(100n, deps);
    expect(out.kind).toBe('posted');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(CLAIMS);
    const [row] = await t.db.select().from(epochs);
    expect(row?.status).toBe('posted');
    expect(row?.txHash).toBe(ROOT(0xabc));
    expect(row?.postedAt).not.toBeNull();
    expect(sent[0]?.data?.startsWith('0x')).toBe(true);
  });

  const failing: [string, Partial<Record<keyof PosterChain, unknown>>, string][] = [
    ['insolvent', { poolBalance: async () => 999_999n }, 'insolvent'],
    [
      'insolvent counts totalClaimed',
      { poolBalance: async () => 100n, totalClaimed: async () => 999_950n },
      '',
    ],
    ['cap exceeded', { maxEpochIncrease: async () => 10n }, 'maxEpochIncrease'],
    ['keeper ETH critical', { keeperEth: async () => 999n }, 'keeper ETH'],
    ['epoch not above maxPostedEpoch', { maxPostedEpoch: async () => 100n }, 'maxPostedEpoch'],
  ];
  for (const [name, over, match] of failing) {
    test(`precheck failure: ${name} -> failed, alert, nothing sent`, async () => {
      await built();
      const { deps, sent } = mkDeps(mkChain(over).chain);
      const out = await postEpoch(100n, deps);
      if (match === '') {
        // pool 100 >= 1_000_000 - 999_950 = 50 -> passes; sanity for the claimed offset
        expect(out.kind).toBe('posted');
        return;
      }
      expect(out.kind).toBe('failed');
      expect((out as { reason: string }).reason).toContain(match);
      expect(sent).toHaveLength(0);
      expect(await status()).toBe('failed');
      const [alert] = await t.db.select().from(kv).where(eq(kv.key, ALERT_KEY));
      expect((alert?.value as { reason: string } | undefined)?.reason ?? '').toContain(match);
      expect((await t.db.select().from(auditLog)).length).toBe(1);
    });
  }

  test('a held-back root lists what it waits for', async () => {
    await built();
    const { deps } = mkDeps(mkChain({ poolBalance: async () => 0n }).chain);
    expect((await postEpoch(100n, deps)).kind).toBe('failed');
    const [item] = (await listEpochs({ limit: 10 })).items;
    expect(item?.status).toBe('failed');
    expect(item?.waitingFor).toBe('settlement');
    expect(waitingFor('keeper ETH below critical')).toBe('keeper_gas');
    expect(waitingFor('maxEpochIncrease exceeded; post in steps')).toBe('epoch_cap');
    expect(waitingFor(undefined)).toBe('other');
  });

  test('total below the previous on-chain root fails', async () => {
    await built(1000n);
    const { chain, roots } = mkChain({ lastEpoch: async () => 50n });
    roots.set(50n, { root: ROOT(1), totalEarned: 5000n, postedAt: 1n });
    const { deps, sent } = mkDeps(chain);
    expect((await postEpoch(100n, deps)).kind).toBe('failed');
    expect(sent).toHaveLength(0);
  });

  test('cap is measured against the last non-vetoed root total', async () => {
    await built(1000n);
    const { chain, roots } = mkChain({ lastEpoch: async () => 50n, maxEpochIncrease: async () => 100n });
    roots.set(50n, { root: ROOT(1), totalEarned: 950n, postedAt: 1n });
    expect((await postEpoch(100n, mkDeps(chain).deps)).kind).toBe('posted');
  });

  test('failed (precheck) is retried by postPending once the condition clears; alert not duplicated', async () => {
    await built();
    let pool = 1n;
    const { chain } = mkChain({ poolBalance: async () => pool });
    const { deps, sent } = mkDeps(chain);
    expect((await postPending(deps)).kind).toBe('failed');
    expect((await postPending(deps)).kind).toBe('failed');
    expect((await t.db.select().from(auditLog)).length).toBe(1);
    pool = 10_000_000n;
    expect((await postPending(deps)).kind).toBe('posted');
    expect(sent).toHaveLength(1);
  });

  test('chain read failure -> no send, status unchanged', async () => {
    await built();
    const { deps, sent } = mkDeps(
      mkChain({
        poolBalance: async () => {
          throw new Error('rpc down');
        },
      }).chain,
    );
    expect((await postEpoch(100n, deps)).kind).toBe('noop');
    expect(sent).toHaveLength(0);
    expect(await status()).toBe('built');
  });

  test('unknown outcome keeps posting with the hash; reconcile reads roots(epoch)', async () => {
    await built();
    const { chain, roots } = mkChain();
    const { deps } = mkDeps(chain, async () => ({ hash: ROOT(0xdead), status: 'unknown' }));
    expect((await postEpoch(100n, deps)).kind).toBe('posting');
    const [row] = await t.db.select().from(epochs);
    expect(row?.status).toBe('posting');
    expect(row?.txHash).toBe(ROOT(0xdead));
    // not on chain yet -> still posting, and never re-sent
    let calls = 0;
    const again = mkDeps(chain, async () => {
      calls++;
      return { hash: ROOT(1), status: 'unknown' };
    });
    expect((await postEpoch(100n, again.deps)).kind).toBe('posting');
    expect(calls).toBe(0);
    // root appears on chain
    roots.set(100n, {
      root: row?.root as Hex,
      totalEarned: row?.totalEarnedUsdgMicros ?? 0n,
      postedAt: 1_700_000_000n,
    });
    expect((await postEpoch(100n, again.deps)).kind).toBe('posted');
    expect(await status()).toBe('posted');
  });

  test('posting with a different on-chain root fails loudly', async () => {
    await built();
    await t.db.update(epochs).set({ status: 'posting' });
    const { chain, roots } = mkChain();
    roots.set(100n, { root: ROOT(9), totalEarned: 1n, postedAt: 5n });
    expect((await postEpoch(100n, mkDeps(chain).deps)).kind).toBe('failed');
  });

  test('stale posting (15 min after send) with no receipt and no root is re-armed to built', async () => {
    await built();
    await t.db.update(epochs).set({ status: 'posting', txHash: ROOT(5) });
    await t.db.insert(kv).values({
      key: postingKey(100n),
      value: { since: new Date(NOW.getTime() - POSTING_STALE_MS - 1000).toISOString() },
    });
    await postEpoch(100n, mkDeps(mkChain().chain).deps);
    expect(await status()).toBe('built');
  });

  test('failed for >15 min, then sent, then unknown -> not re-armed next minute', async () => {
    await built();
    await t.db
      .update(epochs)
      .set({ status: 'failed', builtAt: new Date(NOW.getTime() - 3 * POSTING_STALE_MS) });
    const unknown = mkDeps(mkChain().chain, async () => ({ hash: ROOT(8), status: 'unknown' }));
    expect((await postPending(unknown.deps)).kind).toBe('posting');
    const next = { ...unknown.deps, now: () => new Date(NOW.getTime() + 60_000) };
    await postPending(next);
    expect(await status()).toBe('posting');
  });

  test('reverted tx -> failed and is not retried', async () => {
    await built();
    const { deps, sent } = mkDeps(mkChain().chain, async () => ({
      hash: ROOT(7),
      status: 'reverted',
      gasUsed: 1n,
      effectiveGasPrice: 1n,
    }));
    expect((await postPending(deps)).kind).toBe('failed');
    expect((await postPending(deps)).kind).toBe('noop');
    expect(sent).toHaveLength(0);
  });

  test('older pending epochs are superseded by a newer posted one', async () => {
    await built();
    await t.db.insert(epochs).values({
      epoch: 105n,
      root: ROOT(1),
      totalEarnedUsdgMicros: 1n,
      owners: 1,
      treePath: '105.json',
      status: 'posted',
    });
    expect((await postPending(mkDeps(mkChain().chain).deps)).kind).toBe('noop');
  });
});

// ---------------------------------------------------------------- routes

describe('routes', () => {
  const app = () => {
    const a = new Hono<Env>();
    a.onError(jsonError);
    epochRoutes(a);
    return a;
  };

  test('latest: 404 before any post, then the posted epoch', async () => {
    expect((await app().request('/v1/epochs/latest')).status).toBe(404);
    await built();
    await t.db.update(epochs).set({ status: 'posted', postedAt: NOW, txHash: ROOT(3) });
    const res = await app().request('/v1/epochs/latest');
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.epoch).toBe(100);
    expect(j.totalEarned).toBe('1000000');
    expect(j.claimableAt).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
  });

  test('tree streams the dump with immutable caching; bad/unknown epochs rejected', async () => {
    await built();
    const res = await app().request('/v1/epochs/100/tree');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    const j = (await res.json()) as Record<string, unknown>;
    expect(j.format).toBe('standard-v1');
    expect((await app().request('/v1/epochs/999/tree')).status).toBe(404);
    expect((await app().request('/v1/epochs/abc/tree')).status).toBe(400);
  });
});

describe('jsonSafe', () => {
  test('job results with bigint fields serialize', () => {
    const out = jsonSafe({ post: { kind: 'failed', epoch: 498093n, reason: 'insolvent' } });
    expect(out).toEqual({ post: { kind: 'failed', epoch: '498093', reason: 'insolvent' } });
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
