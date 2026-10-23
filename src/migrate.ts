import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './db/client';
import { logger } from './lib/logger';

try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  logger.info('migrations applied');
} catch (err) {
  logger.error({ err }, 'migration failed');
  process.exitCode = 1;
} finally {
  await sql.end();
}
