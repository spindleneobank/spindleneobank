import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestDb } from '../../../test/db-setup';
import { rateCard } from '../../db/schema';
import { dbRef } from '../auth/constants';
import { utcDay } from '../gateway/pricing';
import { buyerFromProvider, defaultRateRows } from './defaults';
import { addDays, ensureRateCard, rateCardFor, rolloverRateCard, setRateCard } from './service';

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  dbRef.db = t.db;
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const TODAY = utcDay();
const TOMORROW = addDays(TODAY, 1);

describe('defaults', () => {
  test('buyer = ceil(provider / 0.8)', () => {
    expect(buyerFromProvider(20_000n)).toBe(25_000n);
    expect(buyerFromProvider(4_000n)).toBe(5_000n);
    expect(buyerFromProvider(1n)).toBe(2n);
    for (const r of defaultRateRows())
      expect((r.buyerMicrosPerUnit * 8000n) / 10000n).toBeGreaterThanOrEqual(r.providerMicrosPerUnit);
  });
});

describe('rollover', () => {
  test('fresh database: seeds today from defaults and copies tomorrow from today', async () => {
    const r = await rolloverRateCard();
    expect(r.today).toBe(defaultRateRows().length);
    expect(r.tomorrow).toBe(r.today);
    expect(await rateCardFor(TODAY)).toEqual(await rateCardFor(TOMORROW));
  });

  test('copies today, not defaults, and is idempotent', async () => {
    await ensureRateCard(TODAY);
    await t.db
      .update(rateCard)
      .set({ providerUsdgMicrosPerUnit: 77n, buyerUsdgMicrosPerUnit: 99n })
      .where(eq(rateCard.day, TODAY));
    expect((await rolloverRateCard()).tomorrow).toBeGreaterThan(0);
    expect((await rateCardFor(TOMORROW))[0]?.buyerMicrosPerUnit).toBe(99n);
    expect(await rolloverRateCard()).toEqual({ today: 0, tomorrow: 0 });
  });

  test('a partially edited tomorrow keeps its rows and only the missing keys are filled', async () => {
    await ensureRateCard(TODAY);
    await setRateCard(TOMORROW, [
      { gpuClass: 0, lane: 'open', unitKind: 'tokens_1m', providerMicrosPerUnit: 1n, buyerMicrosPerUnit: 2n },
    ]);
    await rolloverRateCard();
    const rows = await rateCardFor(TOMORROW);
    expect(rows.length).toBe(defaultRateRows().length);
    expect(rows.find((r) => r.gpuClass === 0 && r.unitKind === 'tokens_1m')?.buyerMicrosPerUnit).toBe(2n);
  });
});

describe('freeze', () => {
  test("today's and past days cannot be edited", async () => {
    await ensureRateCard(TODAY);
    const before = await rateCardFor(TODAY);
    const row = {
      gpuClass: 0,
      lane: 'open' as const,
      unitKind: 'tokens_1m' as const,
      providerMicrosPerUnit: 1n,
      buyerMicrosPerUnit: 2n,
    };
    await expect(setRateCard(TODAY, [row])).rejects.toThrow(/frozen/);
    await expect(setRateCard(addDays(TODAY, -1), [row])).rejects.toThrow(/frozen/);
    expect(await rateCardFor(TODAY)).toEqual(before);
  });

  test('ensureRateCard never overwrites existing rows', async () => {
    await ensureRateCard(TODAY);
    await t.db.update(rateCard).set({ buyerUsdgMicrosPerUnit: 123n }).where(eq(rateCard.day, TODAY));
    expect(await ensureRateCard(TODAY)).toBe(0);
    expect((await rateCardFor(TODAY)).every((r) => r.buyerMicrosPerUnit === 123n)).toBe(true);
  });

  test('tomorrow can be edited, with buyer >= provider', async () => {
    const row = {
      gpuClass: 1,
      lane: 'open' as const,
      unitKind: 'tokens_1m' as const,
      providerMicrosPerUnit: 10n,
      buyerMicrosPerUnit: 13n,
    };
    await setRateCard(TOMORROW, [row]);
    expect(await rateCardFor(TOMORROW)).toEqual([row]);
    await expect(setRateCard(TOMORROW, [{ ...row, buyerMicrosPerUnit: 5n }])).rejects.toThrow();
  });
});
