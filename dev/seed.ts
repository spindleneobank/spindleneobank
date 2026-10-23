/**
 * Seeds the dev database (idempotent: every insert is ON CONFLICT DO NOTHING).
 * Usage: `bun run dev/seed.ts` (also called by dev/bootstrap.ts).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import { DEFAULT_CATALOG } from '../src/shared/catalog';
import { KNOWN } from '../src/shared/chain';
import { Lane, UnitKind } from '../src/shared/enums';
import { account } from './lib/accounts';

const DATABASE_URL =
  process.env.BOOTSTRAP_DATABASE_URL ?? 'postgres://spindle:spindle@127.0.0.1:7232/spindle';

/** Provider price in USDG micros per unit for class 0; buyer price = provider / 0.8. Placeholders. */
const BASE_PROVIDER: Record<(typeof UnitKind)[number], bigint> = {
  tokens_1m: 50_000n, // 0.05 USDG per 1M tokens
  image: 20_000n,
  job: 10_000n,
  gpu_hour: 300_000n,
};
const CLASS_MULTIPLIER = [1n, 2n, 4n, 10n, 20n];

export function rateRows(day: string) {
  const rows: (typeof schema.rateCard.$inferInsert)[] = [];
  for (const [gpuClass, mult] of CLASS_MULTIPLIER.entries()) {
    for (const lane of Lane) {
      for (const unitKind of UnitKind) {
        const provider = (BASE_PROVIDER[unitKind] * mult * (lane === 'sealed' ? 3n : 2n)) / 2n;
        rows.push({
          day,
          gpuClass,
          lane,
          unitKind,
          providerUsdgMicrosPerUnit: provider,
          buyerUsdgMicrosPerUnit: (provider * 10n) / 8n,
        });
      }
    }
  }
  return rows;
}

const dayString = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export interface SeedSummary {
  rateCard: number;
  models: number;
  stockTokens: number;
  admin: number;
}

export async function seed(opts: {
  databaseUrl?: string;
  stock?: { symbol: string; name: string | null; decimals: number; poolAddress: string | null };
}): Promise<SeedSummary> {
  const sql = postgres(opts.databaseUrl ?? DATABASE_URL, { max: 1 });
  const db = drizzle(sql, { schema });
  try {
    const rates = [...rateRows(dayString(0)), ...rateRows(dayString(1))];
    const rc = await db
      .insert(schema.rateCard)
      .values(rates)
      .onConflictDoNothing()
      .returning({ d: schema.rateCard.day });

    const mdl = await db
      .insert(schema.models)
      .values(
        DEFAULT_CATALOG.map((m) => ({
          id: m.id,
          family: m.family,
          engineIds: m.engineIds,
          hfTokenizer: m.hfTokenizer,
          kind: m.kind,
          minVramGb: Math.ceil(m.minVramMb / 1024),
          lanes: m.lanes,
          enabled: true,
          unitKind: m.unitKind,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.models.id });

    let stockCount = 0;
    if (opts.stock) {
      const s = await db
        .insert(schema.stockTokens)
        .values({
          address: KNOWN.NVDA.toLowerCase(),
          symbol: opts.stock.symbol,
          name: opts.stock.name,
          decimals: opts.stock.decimals,
          poolFee: 500,
          poolAddress: opts.stock.poolAddress?.toLowerCase() ?? null,
          verifiedAt: new Date(),
          enabled: true,
        })
        .onConflictDoNothing()
        .returning({ a: schema.stockTokens.address });
      stockCount = s.length;
    }

    const admin = await db
      .insert(schema.users)
      .values({ address: account(0).address.toLowerCase() })
      .onConflictDoNothing()
      .returning({ id: schema.users.id });

    await db
      .insert(schema.kv)
      .values({ key: 'dev:bootstrapped', value: { at: new Date().toISOString() } })
      .onConflictDoNothing();

    return { rateCard: rc.length, models: mdl.length, stockTokens: stockCount, admin: admin.length };
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  console.log('seed (no stock token; run dev:bootstrap for the NVDA row):', await seed({}));
}
