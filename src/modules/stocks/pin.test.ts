/**
 * Regression test for audit finding M-3 (PoC chain/zz_poc_stocks): the daily re-verify switched a stock to
 * whichever pool held the most USDG, which an attacker can arrange with out-of-range, recoverable funds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { auditLog, stockTokens } from '../../db/schema';
import { DEFAULT_STOCKS, listEnabled, reverifyAll, stockDb, upsertVerified } from './service';
import { stockChain, verifyStockToken } from './verify';

const LEGIT = '0x1111111111111111111111111111111111111111';
const EVIL = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const USDG_1M = 1_000_000_000_000n;

type Pool = { address: string; usdg: bigint; liquidity: bigint };
let pools: Record<number, Pool | undefined>;

const fakeClient = {
  getCode: async () => '0x6000',
  readContract: async (a: { functionName: string; args?: unknown[]; address: string }) => {
    const all = Object.values(pools) as (Pool | undefined)[];
    switch (a.functionName) {
      case 'symbol':
        return 'NVDA';
      case 'name':
        return 'NVIDIA';
      case 'decimals':
        return 18;
      case 'getPool':
        return pools[a.args?.[2] as number]?.address ?? '0x0000000000000000000000000000000000000000';
      case 'balanceOf':
        return all.find((p) => p?.address === a.args?.[0])?.usdg ?? 0n;
      case 'liquidity':
        return all.find((p) => p?.address === a.address)?.liquidity ?? 0n;
      default:
        throw new Error(a.functionName);
    }
  },
};

let t: TestDb;
const realClient = stockChain.client;
const realDb = stockDb.db;

beforeAll(async () => {
  t = await setupTestDb();
  stockDb.db = t.db as never;
  stockChain.client = fakeClient as never;
});
afterAll(async () => {
  stockChain.client = realClient;
  stockDb.db = realDb;
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  pools = { 3000: { address: LEGIT, usdg: USDG_1M, liquidity: 1000n } };
});

const stored = async () => (await t.db.select().from(stockTokens).where(eq(stockTokens.address, TOKEN)))[0];

describe('pool selection', () => {
  test('control: the only pool is chosen', async () => {
    const v = await verifyStockToken(TOKEN);
    expect(v.ok && v.poolAddress).toBe(LEGIT);
  });

  test('M-3: pools rank by in-range liquidity, so parked out-of-range USDG does not win', async () => {
    pools[100] = { address: EVIL, usdg: USDG_1M * 10n, liquidity: 0n };
    const v = await verifyStockToken(TOKEN);
    expect(v.ok && v.poolAddress).toBe(LEGIT);
    expect(v.ok && v.poolFee).toBe(3000);
  });

  test('the minimum USDG still applies to the chosen pool', async () => {
    pools[3000] = { address: LEGIT, usdg: 1n, liquidity: 1000n };
    const v = await verifyStockToken(TOKEN);
    expect(v.ok).toBe(false);
  });
});

describe('re-verify never switches pools', () => {
  test('M-3: a deeper new pool leaves poolAddress unchanged, disables the token and alerts', async () => {
    await upsertVerified(TOKEN, true);
    expect((await stored())?.poolAddress).toBe(LEGIT);
    pools[100] = { address: EVIL, usdg: USDG_1M * 2n, liquidity: 5000n };

    const r = await reverifyAll();

    expect(r.disabled).toEqual([TOKEN]);
    const row = await stored();
    expect(row?.poolAddress).toBe(LEGIT);
    expect(row?.poolFee).toBe(3000);
    expect(row?.enabled).toBe(false);
    expect(await listEnabled()).toHaveLength(0);
    const [alert] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'stock.disabled'));
    expect(alert?.subject).toBe(TOKEN);
    expect(alert?.details).toMatchObject({ pinned: LEGIT, deeper: EVIL });
  });

  test('re-enabling after an alert keeps the pin unless the admin names another fee tier', async () => {
    await upsertVerified(TOKEN, true);
    pools[100] = { address: EVIL, usdg: USDG_1M * 2n, liquidity: 5000n };
    await reverifyAll();
    await upsertVerified(TOKEN, true);
    expect((await stored())?.poolAddress).toBe(LEGIT);
    expect((await stored())?.enabled).toBe(true);
    // an explicit admin decision is the one way a pin moves
    await upsertVerified(TOKEN, true, { poolFee: 100 });
    expect((await stored())?.poolAddress).toBe(EVIL);
  });

  test('ordinary day-to-day movement between pools does not disable a token', async () => {
    await upsertVerified(TOKEN, true);
    pools[500] = { address: EVIL, usdg: USDG_1M, liquidity: 1500n };
    expect((await reverifyAll()).disabled).toEqual([]);
    expect((await stored())?.enabled).toBe(true);
    expect((await stored())?.poolAddress).toBe(LEGIT);
  });

  test('metadata is refreshed', async () => {
    await upsertVerified(TOKEN, true);
    await t.db.update(stockTokens).set({ symbol: 'OLD', verifiedAt: new Date(0) });
    await reverifyAll();
    const row = await stored();
    expect(row?.symbol).toBe('NVDA');
    expect(row?.verifiedAt?.getTime()).toBeGreaterThan(0);
  });

  test('a pinned pool that lost its liquidity is disabled, not replaced', async () => {
    await upsertVerified(TOKEN, true);
    pools[3000] = { address: LEGIT, usdg: 1n, liquidity: 1n };
    pools[500] = { address: EVIL, usdg: USDG_1M, liquidity: 1000n };
    expect((await reverifyAll()).disabled).toEqual([TOKEN]);
    expect((await stored())?.poolAddress).toBe(LEGIT);
  });

  test('a transient chain failure changes nothing', async () => {
    await upsertVerified(TOKEN, true);
    const failing = {
      getCode: async () => {
        throw new Error('rpc down');
      },
      readContract: fakeClient.readContract,
    };
    stockChain.client = failing as never;
    try {
      expect((await reverifyAll()).disabled).toEqual([]);
    } finally {
      stockChain.client = fakeClient as never;
    }
    expect((await stored())?.enabled).toBe(true);
  });

  test('a token nobody has verified gets no pool from the re-verify', async () => {
    const [seed] = DEFAULT_STOCKS;
    await t.db
      .insert(stockTokens)
      .values({ address: TOKEN, symbol: seed?.symbol as string, decimals: 18, enabled: false });
    await reverifyAll();
    expect((await stored())?.poolAddress).toBeNull();
  });
});
