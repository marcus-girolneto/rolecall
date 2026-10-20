import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
// PGlite is per-process, so it is always migrated at boot. For Postgres, run migrations at boot too by default;
// set MIGRATE_ON_BOOT=false and run `node dist/db/migrate.js` as a one-off deploy task when scaling horizontally.
if (database.kind === 'pglite' || process.env.MIGRATE_ON_BOOT !== 'false') await runMigrations(database);

const app = await buildApp({ env, database });

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await app.close(); // stops accepting connections and drains in-flight requests
    await database.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  if (database.kind === 'pglite')
    app.log.warn('Using PGlite (%s). Fine for development; use Postgres in production.', env.DATABASE_URL);
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
