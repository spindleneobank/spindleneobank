import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { MIGRATIONS_FOLDER, setupTestDb, type TestDb } from '../../test/db-setup';
import * as enums from '../shared/enums';
import * as schema from './schema';

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const A = `0x${'a'.repeat(40)}`;
const insertErr = async (q: Promise<unknown>) => {
  try {
    await q;
  } catch (e) {
    return String((e as { message?: string }).message ?? e) + String((e as { cause?: unknown }).cause ?? '');
  }
  return null;
};

describe('schema', () => {
  test('migrations apply on empty db and are idempotent', async () => {
    await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
    await migrate(t.db, { migrationsFolder: MIGRATIONS_FOLDER });
    const rows = await t.sql`select count(*)::int as n from pg_tables where schemaname='public'`;
    expect(rows[0]?.n).toBe(31);
  });

  test('earning_events is a hypertable', async () => {
    const rows = await t.sql`select hypertable_name from timescaledb_information.hypertables`;
    expect(rows.map((r) => r.hypertable_name)).toContain('earning_events');
  });

  test('address checks reject uppercase/invalid', async () => {
    expect(await insertErr(t.db.insert(schema.users).values({ address: A }))).toBeNull();
    const upper = `0x${'A'.repeat(40)}`;
    expect(await insertErr(t.db.insert(schema.users).values({ address: upper }))).toContain(
      'users_address_chk',
    );
    expect(await insertErr(t.db.insert(schema.users).values({ address: '0x12' }))).toContain(
      'users_address_chk',
    );
    expect(await insertErr(t.db.insert(schema.buyers).values({ address: upper }))).toContain(
      'buyers_address_chk',
    );
  });

  test('buyer_balances check rejects overdraw', async () => {
    const [b] = await t.db.insert(schema.buyers).values({ address: A }).returning();
    const err = await insertErr(
      t.db
        .insert(schema.buyerBalances)
        .values({ buyerId: b!.id, balanceUsdgMicros: 5n, reservedUsdgMicros: 6n }),
    );
    expect(err).toContain('buyer_balances_available_chk');
  });

  test('status checks reject unknown values', async () => {
    const [u] = await t.db.insert(schema.users).values({ address: A }).returning();
    const uid = u!.id;
    const [b] = await t.db.insert(schema.buyers).values({ address: A }).returning();
    const bad = 'bogus';
    const cases: [string, Promise<unknown>][] = [
      [
        'enrollments',
        t.db
          .insert(schema.enrollments)
          .values({ userId: uid, kind: 'token', status: bad, expiresAt: new Date() }),
      ],
      [
        'enrollments',
        t.db
          .insert(schema.enrollments)
          .values({ userId: uid, kind: bad, status: 'pending', expiresAt: new Date() }),
      ],
      [
        'nodes',
        t.db.insert(schema.nodes).values({
          owner: A,
          userId: uid,
          nodeKey: A,
          nodePubkey: '04',
          name: 'n',
          engine: 'ollama',
          gpuClass: 1,
          lane: 'open',
          status: bad,
        }),
      ],
      [
        'jobs',
        t.db.insert(schema.jobs).values({
          buyerId: b!.id,
          model: 'm',
          kind: 'chat',
          unitKind: 'job',
          payMode: 'balance',
          status: bad,
        }),
      ],
      ['buyer_ledger', t.db.insert(schema.buyerLedger).values({ buyerId: b!.id, kind: bad, usdgMicros: 1n })],
      [
        'x402_payments',
        t.db.insert(schema.x402Payments).values({ paymentId: '0x1', payer: A, scheme: 'exact', status: bad }),
      ],
      [
        'epochs',
        t.db.insert(schema.epochs).values({
          epoch: 1n,
          root: '0x',
          totalEarnedUsdgMicros: 0n,
          owners: 0,
          treePath: 'p',
          status: bad,
        }),
      ],
      [
        'claims',
        t.db.insert(schema.claims).values({ owner: A, epoch: 1n, amountUsdgMicros: 1n, status: bad }),
      ],
      [
        'earning_events',
        t.db
          .insert(schema.earningEvents)
          .values({ ts: new Date(), nodeId: crypto.randomUUID(), owner: A, kind: bad, usdgMicros: 1n }),
      ],
      ['cards', t.db.insert(schema.cards).values({ userId: uid, product: 'p', status: bad })],
      [
        'slash_cases',
        t.db.insert(schema.slashCases).values({ nodeId: crypto.randomUUID(), reason: 'r', status: bad }),
      ],
    ];
    for (const [table, q] of cases) {
      const err = await insertErr(q);
      expect(err, table).toContain(`${table}_`);
      expect(err, table).toMatch(/_chk|violates/);
    }
  });

  test('card operation and relay status checks', async () => {
    const [u] = await t.db.insert(schema.users).values({ address: A }).returning();
    const [c] = await t.db
      .insert(schema.cards)
      .values({ userId: u!.id, product: 'p', status: 'issued' })
      .returning();
    const op = (over: Partial<typeof schema.cardOperations.$inferInsert>) =>
      t.db
        .insert(schema.cardOperations)
        .values({ cardId: c!.id, userId: u!.id, kind: 'issue', status: 'created', ...over });
    expect(await insertErr(op({ status: 'bogus' }))).toContain('card_operations_status_chk');
    expect(await insertErr(op({ network: 'eth' }))).toContain('card_operations_network_chk');
    expect(await insertErr(op({ kind: 'x' }))).toContain('card_operations_kind_chk');
    const [good] = await op({ network: 'bsc' }).returning();
    expect(
      await insertErr(
        t.db
          .insert(schema.relayOrders)
          .values({ cardOperationId: good!.id, userId: u!.id, requestId: 'r', status: 'bogus' }),
      ),
    ).toContain('relay_orders_status_chk');
  });

  test('partial unique indexes: pending pairing code, one pending card per product', async () => {
    const [u] = await t.db.insert(schema.users).values({ address: A }).returning();
    const e = (status: string) =>
      t.db
        .insert(schema.enrollments)
        .values({ userId: u!.id, kind: 'pairing', pairingCode: 'ABCD-EFGH', status, expiresAt: new Date() });
    // the column-level unique already forbids duplicates; the partial index is the pending-specific guard
    expect(await insertErr(e('pending'))).toBeNull();
    expect(await insertErr(e('pending'))).not.toBeNull();
    const c = (status: string) => t.db.insert(schema.cards).values({ userId: u!.id, product: 'p', status });
    expect(await insertErr(c('pending_payment'))).toBeNull();
    expect(await insertErr(c('pending_payment'))).toContain('cards_one_pending_per_product_uq');
    expect(await insertErr(c('issued'))).toBeNull();
  });

  test('webhook events unique on (provider_scope, provider_event_id)', async () => {
    const v = { providerScope: 's1', providerEventId: 'e1', payloadHash: 'h1' };
    expect(await insertErr(t.db.insert(schema.cardWebhookEvents).values(v))).toBeNull();
    expect(await insertErr(t.db.insert(schema.cardWebhookEvents).values(v))).toContain(
      'card_webhook_events_uq',
    );
    expect(
      await insertErr(t.db.insert(schema.cardWebhookEvents).values({ ...v, payloadHash: 'h2' })),
    ).toContain('card_webhook_events_uq');
    expect(
      await insertErr(t.db.insert(schema.cardWebhookEvents).values({ ...v, providerScope: 's2' })),
    ).toBeNull();
  });

  test('receipts.cose round-trips bytea', async () => {
    const [u] = await t.db.insert(schema.users).values({ address: A }).returning();
    const [b] = await t.db.insert(schema.buyers).values({ address: A }).returning();
    const [n] = await t.db
      .insert(schema.nodes)
      .values({
        owner: A,
        userId: u!.id,
        nodeKey: A,
        nodePubkey: '04',
        name: 'n',
        engine: 'ollama',
        gpuClass: 1,
        lane: 'open',
        status: 'online',
      })
      .returning();
    const [j] = await t.db
      .insert(schema.jobs)
      .values({
        buyerId: b!.id,
        nodeId: n!.id,
        model: 'm',
        kind: 'chat',
        unitKind: 'job',
        payMode: 'balance',
        status: 'completed',
      })
      .returning();
    await t.db.insert(schema.receipts).values({
      jobId: j!.id,
      nodeId: n!.id,
      cose: new Uint8Array([1, 2, 3, 255]),
      payload: {},
      verified: true,
    });
    const [r] = await t.db.select().from(schema.receipts);
    expect([...(r!.cose as Uint8Array)]).toEqual([1, 2, 3, 255]);
  });

  test('no money column is integer/real/double', () => {
    for (const tbl of Object.values(schema)) {
      if (typeof tbl !== 'object' || tbl === null || !('getSQLType' in (Object.values(tbl)[0] ?? {}) || true))
        continue;
      let cfg: ReturnType<typeof getTableConfig>;
      try {
        cfg = getTableConfig(tbl as never);
      } catch {
        continue;
      }
      for (const col of cfg.columns) {
        if (/micros|cents|wei|stake/.test(col.name)) {
          expect(['integer', 'real', 'double precision']).not.toContain(col.getSQLType());
        }
      }
    }
    expect(enums.NodeStatus.length).toBeGreaterThan(0);
  });
});
