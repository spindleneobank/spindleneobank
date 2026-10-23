import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

/** Renders `col in ('a','b')` from a TS tuple so the DB check and the enum cannot drift. */
export function inList(col: AnyColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', ');
  return sql`${col} in (${sql.raw(list)})`;
}

/** Same as inList but allows NULL. */
export function inListOrNull(col: AnyColumn, values: readonly string[]): SQL {
  return sql`(${col} is null or ${inList(col, values)})`;
}

/** Lowercase 0x address check. */
export function isAddress(col: AnyColumn): SQL {
  return sql`${col} ~ '^0x[0-9a-f]{40}$'`;
}

export function isAddressOrNull(col: AnyColumn): SQL {
  return sql`(${col} is null or ${isAddress(col)})`;
}
