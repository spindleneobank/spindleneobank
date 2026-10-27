import { and, eq, gte, sql } from 'drizzle-orm';
import { buyerBalances, buyerLedger, buyers } from './schema';
import type { Tx } from './types';

/** Upsert the buyer (and its zero balance row) and return its id. Address must be lowercase. */
export async function ensureBuyer(tx: Tx, address: string): Promise<string> {
  const [row] = await tx
    .insert(buyers)
    .values({ address })
    .onConflictDoUpdate({ target: buyers.address, set: { address } })
    .returning({ id: buyers.id });
  if (!row) throw new Error('ensureBuyer: no row returned');
  await tx.insert(buyerBalances).values({ buyerId: row.id }).onConflictDoNothing();
  return row.id;
}

/** Atomically reserve funds. Returns false (and changes nothing) when available balance is insufficient. */
export async function reserve(tx: Tx, buyerId: string, micros: bigint): Promise<boolean> {
  if (micros < 0n) throw new RangeError('negative reserve');
  const rows = await tx
    .update(buyerBalances)
    .set({
      reservedUsdgMicros: sql`${buyerBalances.reservedUsdgMicros} + ${micros}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(buyerBalances.buyerId, buyerId),
        sql`${buyerBalances.balanceUsdgMicros} - ${buyerBalances.reservedUsdgMicros} >= ${micros}`,
      ),
    )
    .returning({ buyerId: buyerBalances.buyerId });
  return rows.length > 0;
}

/** Release a reservation. Returns false when less than `micros` is reserved (nothing changes). */
export async function release(tx: Tx, buyerId: string, micros: bigint): Promise<boolean> {
  if (micros < 0n) throw new RangeError('negative release');
  const rows = await tx
    .update(buyerBalances)
    .set({
      reservedUsdgMicros: sql`${buyerBalances.reservedUsdgMicros} - ${micros}`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(buyerBalances.buyerId, buyerId), gte(buyerBalances.reservedUsdgMicros, micros)))
    .returning({ buyerId: buyerBalances.buyerId });
  return rows.length > 0;
}

/**
 * Settle a job: drop `reservedMicros` from reserved, deduct `chargeMicros` from balance and write a
 * negative `charge` ledger row. Run inside the caller's transaction; throws (check constraint) if
 * it would overdraw, which rolls the transaction back.
 */
export async function charge(
  tx: Tx,
  args: { buyerId: string; reservedMicros: bigint; chargeMicros: bigint; jobId: string },
): Promise<void> {
  const { buyerId, reservedMicros, chargeMicros, jobId } = args;
  if (reservedMicros < 0n || chargeMicros < 0n) throw new RangeError('negative amount');
  const rows = await tx
    .update(buyerBalances)
    .set({
      reservedUsdgMicros: sql`${buyerBalances.reservedUsdgMicros} - ${reservedMicros}`,
      balanceUsdgMicros: sql`${buyerBalances.balanceUsdgMicros} - ${chargeMicros}`,
      updatedAt: sql`now()`,
    })
    .where(eq(buyerBalances.buyerId, buyerId))
    .returning({ buyerId: buyerBalances.buyerId });
  if (rows.length === 0) throw new Error('charge: buyer balance not found');
  await tx.insert(buyerLedger).values({ buyerId, kind: 'charge', usdgMicros: -chargeMicros, jobId });
}

/** Credit a charge back to the buyer: `balance += micros` and a positive `refund` ledger row for the job. */
export async function refund(
  tx: Tx,
  args: { buyerId: string; micros: bigint; jobId: string },
): Promise<void> {
  const { buyerId, micros, jobId } = args;
  if (micros <= 0n) return;
  await tx
    .update(buyerBalances)
    .set({
      balanceUsdgMicros: sql`${buyerBalances.balanceUsdgMicros} + ${micros}`,
      updatedAt: sql`now()`,
    })
    .where(eq(buyerBalances.buyerId, buyerId));
  await tx.insert(buyerLedger).values({ buyerId, kind: 'refund', usdgMicros: micros, jobId });
}

/** Idempotent deposit credit keyed on (txHash, logIndex). Returns true when newly credited. */
export async function credit(
  tx: Tx,
  args: { buyerId: string; micros: bigint; txHash: string; logIndex: number },
): Promise<boolean> {
  const { buyerId, micros, txHash, logIndex } = args;
  const inserted = await tx
    .insert(buyerLedger)
    .values({ buyerId, kind: 'deposit', usdgMicros: micros, txHash, logIndex })
    .onConflictDoNothing({ target: [buyerLedger.txHash, buyerLedger.logIndex] })
    .returning({ id: buyerLedger.id });
  if (inserted.length === 0) return false;
  await tx
    .insert(buyerBalances)
    .values({ buyerId, balanceUsdgMicros: micros })
    .onConflictDoUpdate({
      target: buyerBalances.buyerId,
      set: {
        balanceUsdgMicros: sql`${buyerBalances.balanceUsdgMicros} + ${micros}`,
        updatedAt: sql`now()`,
      },
    });
  return true;
}
