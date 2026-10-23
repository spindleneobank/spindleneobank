import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './db/client';
import { logger } from './lib/logger';

const folder = 'drizzle';

try {
  if (existsSync(`${folder}/meta/_journal.json`)) {
    await migrate(db, { migrationsFolder: folder });
    logger.info('migrations applied');
  } else {
    // Skeleton state: B1 generates the first migration.
    logger.info('no migrations generated yet, nothing to apply');
  }
} catch (err) {
  logger.error({ err }, 'migration failed');
  process.exitCode = 1;
} finally {
  await sql.end();
}
