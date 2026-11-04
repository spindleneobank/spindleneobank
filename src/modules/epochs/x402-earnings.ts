/**
 * An x402 job is served before its payment settles on-chain, so what it earns is only real once the payment
 * settles. Until then the earning stays out of epoch trees. If the payment fails or expires the buyer paid
 * nothing into SpindleClaims, so the earning is reversed rather than paid from other buyers' deposits.
 */
import { sql } from 'drizzle-orm';
import type { dbRef } from '../auth/constants';

/** True for an earning whose job is paid by an x402 payment that has not reached a final state. */
export const isHeldForX402 = sql`exists (
  select 1 from jobs j join x402_payments p on p.id = j.x402_payment_id
  where j.id = earning_events.job_id and p.status in ('open', 'closing', 'settling')
)`;

type Db = Pick<typeof dbRef.db, 'execute'>;

/**
 * Writes one `x402_reversal` per earning whose payment failed or expired. Idempotent. The reversal keeps the
 * earning's timestamp, so a build assigns the pair to the same epoch and they net to zero.
 */
export async function reverseUnpaidEarnings(db: Db): Promise<number> {
  const rows = await db.execute(sql`
    insert into earning_events (ts, node_id, owner, job_id, kind, usdg_micros)
    select e.ts, e.node_id, e.owner, e.job_id, 'x402_reversal', -e.usdg_micros
    from earning_events e
    join jobs j on j.id = e.job_id
    join x402_payments p on p.id = j.x402_payment_id
    where e.kind = 'job' and p.status in ('failed', 'expired')
      and not exists (
        select 1 from earning_events r where r.job_id = e.job_id and r.kind = 'x402_reversal'
      )
    returning job_id`);
  return rows.length;
}
