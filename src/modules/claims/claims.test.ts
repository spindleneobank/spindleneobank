import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { claims, earningEvents, epochs } from '../../db/schema';
import type { AppError } from '../../lib/errors';
import { type Env, jsonError } from '../../lib/http';
import { closeRedis } from '../../lib/redis';
import { dbRef } from '../auth/constants';
import authRoutes from '../auth/routes';
import { createTestSession } from '../auth/testing';
import { buildEpoch } from '../epochs/builder';
import { epochSettings } from '../epochs/service';
import routes from './routes';
import { getProof, type ProofDeps } from './service';

let t: TestDb;
const addr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as `0x${string}`;
const A = addr();
const B = addr();
const NOW = new Date((101 * 3600 + 600) * 1000);
const POSTED = new Date(NOW.getTime() + 10_000);
const CONTRACT = '0x00000000000000000000000000000000000000c1' as const;

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
  epochSettings.claimMinMicros = 10_000_000n;
});

type Page = { items: { amountMicros: string }[]; nextCursor: string | null };
const deps = (now: Date, claimed = 0n): ProofDeps => ({
  now: () => now,
  claimsAddress: () => CONTRACT,
  claimedOnchain: async () => claimed,
});
async function seed(a = 25_000_000n) {
  await t.db.insert(earningEvents).values([
    {
      ts: new Date(100 * 3600_000 + 60_000),
      nodeId: '00000000-0000-4000-8000-000000000001',
      owner: A,
      kind: 'job',
      usdgMicros: a,
    },
    {
      ts: new Date(100 * 3600_000 + 60_000),
      nodeId: '00000000-0000-4000-8000-000000000001',
      owner: B,
      kind: 'job',
      usdgMicros: 3n,
    },
  ]);
  await buildEpoch(100n, { now: NOW });
  await t.db.update(epochs).set({ status: 'posted', postedAt: POSTED });
}
const afterDelay = new Date(POSTED.getTime() + 3_600_000);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected rejection');
};

describe('getProof', () => {
  test('returns the owner leaf proof that verifies against the posted root', async () => {
    await seed();
    const p = await getProof(A, deps(afterDelay, 5_000_000n));
    expect(p).toMatchObject({
      epoch: 100,
      cumulativeMicros: '25000000',
      claimedMicros: '5000000',
      claimableMicros: '20000000',
      contract: CONTRACT,
      abiFn: 'claim',
    });
    const { StandardMerkleTree } = await import('@openzeppelin/merkle-tree');
    const [row] = await t.db.select().from(epochs);
    expect(
      StandardMerkleTree.verify(row?.root as string, ['address', 'uint256'], [A, '25000000'], p.proof),
    ).toBe(true);
  });

  test('inside the 1h delay -> 409 CHAIN_STATE', async () => {
    await seed();
    const e = await code(getProof(A, deps(new Date(POSTED.getTime() + 3_599_000))));
    expect(e.code).toBe('CHAIN_STATE');
    expect(e.status).toBe(409);
  });

  test('below minimum -> 409 with belowMinimum and amounts', async () => {
    await seed(25_000_000n);
    const e = await code(getProof(A, deps(afterDelay, 20_000_000n)));
    expect(e.status).toBe(409);
    expect(e.details).toMatchObject({
      belowMinimum: true,
      claimableMicros: '5000000',
      minClaimMicros: '10000000',
    });
  });

  test('fully claimed, unknown owner, vetoed or unposted root -> 409', async () => {
    await seed();
    expect((await code(getProof(A, deps(afterDelay, 25_000_000n)))).status).toBe(409);
    expect((await code(getProof(addr(), deps(afterDelay)))).status).toBe(409);
    await t.db.update(epochs).set({ status: 'vetoed' });
    expect((await code(getProof(A, deps(afterDelay)))).status).toBe(409);
    await t.db.update(epochs).set({ status: 'built', postedAt: null });
    expect((await code(getProof(A, deps(afterDelay)))).status).toBe(409);
  });

  test('uses the newest root past its delay, not a newer one still inside it', async () => {
    await seed();
    const later = new Date(NOW.getTime() + 3600_000);
    await t.db.insert(earningEvents).values({
      ts: new Date(101 * 3600_000 + 60_000),
      nodeId: '00000000-0000-4000-8000-000000000001',
      owner: A,
      kind: 'job',
      usdgMicros: 1_000_000n,
    });
    await buildEpoch(101n, { now: later });
    await t.db
      .update(epochs)
      .set({ status: 'posted', postedAt: new Date(afterDelay.getTime() - 1000) })
      .where((await import('drizzle-orm')).eq(epochs.epoch, 101n));
    const p = await getProof(A, deps(afterDelay));
    expect(p.epoch).toBe(100);
  });
});

describe('routes', () => {
  test('claim/proof and claims require a session; claims list paginates newest first', async () => {
    await seed();
    const app = new Hono<Env>();
    app.onError(jsonError);
    authRoutes(app);
    routes(app);
    expect((await app.request('/v1/app/claim/proof')).status).toBe(401);
    expect((await app.request('/v1/app/claims')).status).toBe(401);
    const s = await createTestSession(A);
    for (let i = 0; i < 3; i++)
      await t.db.insert(claims).values({
        owner: A,
        epoch: 100n,
        amountUsdgMicros: BigInt(i + 1),
        txHash: `0x${i}`,
        status: 'confirmed',
        createdAt: new Date(Date.now() - i * 1000),
      });
    await t.db
      .insert(claims)
      .values({ owner: B, epoch: 100n, amountUsdgMicros: 99n, txHash: '0xother', status: 'confirmed' });
    const r1 = (await (await app.request('/v1/app/claims?limit=2', { headers: s.headers })).json()) as Page;
    expect(r1.items.map((i: { amountMicros: string }) => i.amountMicros)).toEqual(['1', '2']);
    expect(r1.nextCursor).not.toBeNull();
    const r2 = (await (
      await app.request(`/v1/app/claims?limit=2&cursor=${r1.nextCursor}`, { headers: s.headers })
    ).json()) as Page;
    expect(r2.items.map((i: { amountMicros: string }) => i.amountMicros)).toEqual(['3']);
    expect(r2.nextCursor).toBeNull();
    expect((await app.request('/v1/app/claims?cursor=garbage', { headers: s.headers })).status).toBe(400);
  });
});
