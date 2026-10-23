import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { setupTestDb, type TestDb } from '../../test/db-setup';
import { charge, credit, ensureBuyer, release, reserve } from './balances';
import { buyerBalances, buyerLedger } from './schema';

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const A = `0x${'b'.repeat(40)}`;
const bal = async (id: string) => {
  const [r] = await t.db.select().from(buyerBalances).where(eq(buyerBalances.buyerId, id));
  return r!;
};
async function funded(micros: bigint) {
  const id = await ensureBuyer(t.db, A);
  await credit(t.db, { buyerId: id, micros, txHash: `0x${'1'.repeat(64)}`, logIndex: 0 });
  return id;
}

describe('balances', () => {
  test('ensureBuyer is idempotent', async () => {
    const a = await ensureBuyer(t.db, A);
    expect(await ensureBuyer(t.db, A)).toBe(a);
    expect((await bal(a)).balanceUsdgMicros).toBe(0n);
  });

  test('reserve fails when insufficient; concurrent reserves never overdraw', async () => {
    const id = await funded(10n);
    expect(await reserve(t.db, id, 11n)).toBe(false);
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(t.db, id, 1n)));
    expect(results.filter(Boolean).length).toBe(10);
    const b = await bal(id);
    expect(b.reservedUsdgMicros).toBe(10n);
    expect(b.balanceUsdgMicros).toBe(10n);
    expect(await reserve(t.db, id, 1n)).toBe(false);
  });

  test('release returns reserved funds and refuses to go negative', async () => {
    const id = await funded(10n);
    await reserve(t.db, id, 4n);
    expect(await release(t.db, id, 5n)).toBe(false);
    expect(await release(t.db, id, 4n)).toBe(true);
    expect((await bal(id)).reservedUsdgMicros).toBe(0n);
  });

  test('charge moves reserved to spent and writes ledger', async () => {
    const id = await funded(100n);
    await reserve(t.db, id, 30n);
    const jobId = crypto.randomUUID();
    await t.db.transaction((tx) =>
      charge(tx, { buyerId: id, reservedMicros: 30n, chargeMicros: 22n, jobId }),
    );
    const b = await bal(id);
    expect(b.balanceUsdgMicros).toBe(78n);
    expect(b.reservedUsdgMicros).toBe(0n);
    const rows = await t.db.select().from(buyerLedger).where(eq(buyerLedger.kind, 'charge'));
    expect(rows.length).toBe(1);
    expect(rows[0]?.usdgMicros).toBe(-22n);
    expect(rows[0]?.jobId).toBe(jobId);
  });

  test('charge that would overdraw rolls back', async () => {
    const id = await funded(10n);
    await reserve(t.db, id, 5n);
    await expect(
      t.db.transaction((tx) =>
        charge(tx, { buyerId: id, reservedMicros: 5n, chargeMicros: 11n, jobId: crypto.randomUUID() }),
      ),
    ).rejects.toThrow();
    const b = await bal(id);
    expect(b.balanceUsdgMicros).toBe(10n);
    expect(b.reservedUsdgMicros).toBe(5n);
    expect((await t.db.select().from(buyerLedger).where(eq(buyerLedger.kind, 'charge'))).length).toBe(0);
  });

  test('credit is idempotent per (tx_hash, log_index)', async () => {
    const id = await ensureBuyer(t.db, A);
    const args = { buyerId: id, micros: 50n, txHash: `0x${'2'.repeat(64)}`, logIndex: 3 };
    const results = await Promise.all([credit(t.db, args), credit(t.db, args), credit(t.db, args)]);
    expect(results.filter(Boolean).length).toBe(1);
    expect((await bal(id)).balanceUsdgMicros).toBe(50n);
    expect(await credit(t.db, { ...args, logIndex: 4 })).toBe(true);
    expect((await bal(id)).balanceUsdgMicros).toBe(100n);
  });
});
