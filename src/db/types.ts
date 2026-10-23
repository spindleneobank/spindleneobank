import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** Either the db or a transaction; helpers accept this so callers compose them. */
export type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
export type DbTransaction = PostgresJsTransaction<typeof schema, Record<string, never>>;

export type User = InferSelectModel<typeof schema.users>;
export type Node = InferSelectModel<typeof schema.nodes>;
export type NewNode = InferInsertModel<typeof schema.nodes>;
export type Job = InferSelectModel<typeof schema.jobs>;
export type NewJob = InferInsertModel<typeof schema.jobs>;
export type Buyer = InferSelectModel<typeof schema.buyers>;
export type Card = InferSelectModel<typeof schema.cards>;
export type CardOperation = InferSelectModel<typeof schema.cardOperations>;
export type X402Payment = InferSelectModel<typeof schema.x402Payments>;
export type EarningEvent = InferSelectModel<typeof schema.earningEvents>;
