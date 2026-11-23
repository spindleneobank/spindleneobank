import { readdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../src/db/schema';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://spindle:spindle@127.0.0.1:7232/spindle_test';

export const MIGRATIONS_FOLDER = new URL('../drizzle', import.meta.url).pathname;

async function ensureDatabase(): Promise<void> {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('unsafe test database name');
  u.pathname = '/postgres';
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    const found = await admin`select 1 from pg_database where datname = ${name}`;
    if (found.length === 0) await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
}

export interface TestDb {
  sql: postgres.Sql;
  db: ReturnType<typeof drizzle<typeof schema>>;
  /** Truncate every public table (call in beforeEach / beforeAll). */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Connects to the throwaway test database, creating it and applying migrations if needed. */
export async function setupTestDb(): Promise<TestDb> {
  await ensureDatabase();
  const sql = postgres(url, { max: 30, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    sql,
    db,
    async reset() {
      const tables = await sql<{ tablename: string }[]>`
        select tablename from pg_tables where schemaname = 'public'`;
      if (tables.length === 0) return;
      const list = tables.map((t) => `"${t.tablename}"`).join(', ');
      // work a previous test started in the background can still hold row locks: retry a deadlocked truncate
      for (let attempt = 1; ; attempt++) {
        try {
          await sql.unsafe(`truncate ${list} restart identity cascade`);
          return;
        } catch (err) {
          if ((err as { code?: string }).code !== '40P01' || attempt >= 5) throw err;
          await new Promise((r) => setTimeout(r, 50 * attempt));
        }
      }
    },
    close: () => sql.end(),
  };
}

export const migrationFiles = () => readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('.sql'));
