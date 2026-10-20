# ADR 0002 — PostgreSQL + Drizzle, with PGlite for development and tests

- Status: accepted
- Date: 2026-10-19

## Context

We need relational integrity (orgs → projects → runs, unique `(project, root_hash)`), atomic counters for quotas,
JSON columns, and a database every cloud offers as a managed service. Developers and CI must be able to run the API and
its tests without Docker or a running database.

## Decision

- **PostgreSQL 17** in production (RDS, Fly Postgres, Render).
- **Drizzle ORM 0.45** for a typed schema and query builder that stays close to SQL. `drizzle-kit generate` produces
  plain SQL migrations committed under `apps/api/drizzle/`; the app applies them with Drizzle's migrator.
- **PGlite** (Postgres compiled to WASM, in-process) when `DATABASE_URL` is `pglite://memory` or `pglite://<dir>`.
  Same SQL dialect, same migrations, zero setup. Tests use a fresh in-memory instance per file.
- Repositories depend on a driver-agnostic `PgDatabase` type; `db/client.ts` picks the driver from the URL.

## Consequences

- Tests exercise real Postgres semantics (constraints, `ON CONFLICT`, transactions) without a server.
- PGlite is single-connection and single-process: never use it in production (the server logs a warning).
- Bundle texts are stored in `text` columns. Fine up to the 5 MB upload cap and current volumes; if storage grows we
  move blobs to object storage (S3) keyed by run id and keep only metadata in Postgres (see ADR 0004).
