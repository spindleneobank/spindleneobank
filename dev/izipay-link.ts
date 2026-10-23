/**
 * DEV ONLY: link an existing izipay (live) card to a dev user so the Cards tab can show it.
 *
 * Usage: bun run dev/izipay-link.ts <providerCardId> <ownerAddress>
 *
 * Reads the card from izipay (GET /cards/{id}, read-only), upserts the `users` row for the owner and
 * creates (or updates) the `cards` row with a random client_card_ref and the provider's status/last4/balance.
 * Never writes to the provider and never prints the PAN, CVV or expiry. Run inside the api container
 * (it needs the izipay env), e.g.
 *   docker cp dev/izipay-link.ts <api>:/app/dev/ && docker exec <api> bun run dev/izipay-link.ts card_x 0x...
 */
import postgres from 'postgres';

const USAGE = `Usage: bun run dev/izipay-link.ts <providerCardId> <ownerAddress>

Links an existing izipay card to a dev user (creates users/cards rows; status, last4 and balance
come from GET /cards/{id}). Read-only towards izipay. Refuses to run when NODE_ENV=production.
Options: --help`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
if (process.env.NODE_ENV === 'production') {
  console.error('izipay-link: refusing to run with NODE_ENV=production');
  process.exit(1);
}
const [providerCardId, ownerAddress] = args;
if (
  !providerCardId ||
  !/^[A-Za-z0-9_-]{1,128}$/.test(providerCardId) ||
  !/^0x[0-9a-fA-F]{40}$/.test(ownerAddress ?? '')
) {
  console.error(USAGE);
  process.exit(2);
}

// Imported lazily so --help and the production refusal never load config or touch the network.
const { provider } = await import('../src/modules/cards/provider');
const { normalizeCard, decimalToCents } = await import('../src/modules/cards/domain');
const { liveWritesBlocked, providerScope } = await import('../src/modules/cards/settings');
if (!liveWritesBlocked() && process.env.IZIPAY_MODE === 'live') {
  console.error('izipay-link: refusing, live writes are enabled (IZIPAY_LIVE_WRITES must be false)');
  process.exit(1);
}

const data = normalizeCard(await provider.card(providerCardId));
if (data.providerCardId !== providerCardId) throw new Error('provider returned a different card id');
const status = data.issueStatus === 'unknown' ? 'pending_payment' : data.issueStatus;
const cents = decimalToCents(data.balanceUsd);
const address = (ownerAddress as string).toLowerCase();

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://spindle:spindle@127.0.0.1:7232/spindle');
try {
  const [user] = await sql`
    insert into users (address) values (${address})
    on conflict (address) do update set address = excluded.address returning id`;
  const [row] = await sql`
    insert into cards (user_id, provider_scope, provider_card_id, client_card_ref, product, last4, status, balance_usd_cents, issued_at, synced_at)
    values (${user!.id}, ${providerScope()}, ${providerCardId}, ${crypto.randomUUID()}, 'mastercard', ${data.last4}, ${status},
            ${cents === null ? null : cents.toString()}, ${data.issuedAt}, now())
    on conflict (provider_card_id) do update set
      user_id = excluded.user_id, provider_scope = excluded.provider_scope, last4 = excluded.last4, status = excluded.status,
      balance_usd_cents = excluded.balance_usd_cents, issued_at = excluded.issued_at, synced_at = now()
    returning id, status, last4, balance_usd_cents`;
  console.log(
    JSON.stringify({
      linked: true,
      cardId: row!.id,
      providerCardId,
      status: row!.status,
      last4: row!.last4,
      balanceUsdCents: String(row!.balance_usd_cents),
      owner: address,
    }),
  );
} finally {
  await sql.end();
}
process.exit(0);
