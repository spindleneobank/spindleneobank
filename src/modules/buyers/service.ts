import { charge, ensureBuyer, release as releaseDb, reserve as reserveDb } from '../../db/balances';
import { AppError } from '../../lib/errors';
import { dbRef } from '../auth/constants';

/** Buyer id for a wallet address (upserts the buyer and its zero balance row). */
export async function buyerIdForAddress(address: string): Promise<string> {
  return ensureBuyer(dbRef.db, address.toLowerCase());
}

/**
 * Reserve `maxMicros` of the buyer's balance:
 * `UPDATE buyer_balances SET reserved = reserved + $max WHERE buyer_id=$1 AND balance - reserved >= $max`.
 * Zero rows affected means INSUFFICIENT_BALANCE (402).
 */
export async function reserve(buyerId: string, maxMicros: bigint): Promise<void> {
  const ok = await reserveDb(dbRef.db, buyerId, maxMicros);
  if (!ok) throw new AppError('INSUFFICIENT_BALANCE', 'Insufficient balance for this request.');
}

/**
 * One transaction: `reserved -= reservedMicros`, `balance -= chargeMicros` and a `charge` ledger row.
 * `chargeMicros` is clamped to `reservedMicros` so a settlement can never overdraw the buyer.
 */
export async function settleCharge(
  buyerId: string,
  reservedMicros: bigint,
  chargeMicros: bigint,
  jobId: string,
): Promise<bigint> {
  const final = chargeMicros > reservedMicros ? reservedMicros : chargeMicros;
  await dbRef.db.transaction((tx) => charge(tx, { buyerId, reservedMicros, chargeMicros: final, jobId }));
  return final;
}

/** Give back an unused reservation. */
export async function release(buyerId: string, reservedMicros: bigint): Promise<void> {
  await releaseDb(dbRef.db, buyerId, reservedMicros);
}
