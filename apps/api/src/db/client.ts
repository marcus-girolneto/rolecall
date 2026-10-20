import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import { schema } from './schema.js';

/** Driver-agnostic Drizzle handle. Repositories depend on this, never on a concrete driver. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  kind: 'pglite' | 'postgres';
  /** Cheap round-trip used by /readyz. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * `pglite://memory`  → in-process Postgres (WASM), data lost on exit. Default for dev and tests.
 * `pglite://<dir>`   → in-process Postgres persisted to a directory.
 * `postgres://…`     → real Postgres via a pg connection pool (production).
 */
export function createDatabase(url: string): DatabaseHandle {
  if (url.startsWith('pglite://')) {
    const location = url.slice('pglite://'.length);
    const client = location === 'memory' || location === '' ? new PGlite() : new PGlite(location);
    const db = drizzlePglite({ client, schema }) as unknown as Database;
    return { db, kind: 'pglite', ping: () => ping(db), close: () => client.close() };
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzlePg({ client: pool, schema }) as unknown as Database;
    return { db, kind: 'postgres', ping: () => ping(db), close: () => pool.end() };
  }
  throw new Error('DATABASE_URL must be pglite://memory, pglite://<dir> or postgres://…');
}

async function ping(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
