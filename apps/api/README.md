# Rolecall Cloud API (`@rolecall/api`)

Multi-tenant backend for Rolecall Cloud. It stores evidence bundles uploaded by `rolecall push`, re-verifies every
hash (and signature) server-side, serves run history and regressions to the dashboard, and enforces plan limits.

Architecture and decisions: [`docs/architecture.md`](../../docs/architecture.md) and [`docs/adr/`](../../docs/adr).

## Run locally (no database to install)

```bash
pnpm --filter @rolecall/core build   # once, the API imports the built core package
pnpm --filter @rolecall/api dev      # tsx watch, PGlite in memory, http://localhost:8787
```

- OpenAPI UI: http://localhost:8787/docs (JSON at `/docs/json`)
- Health: `GET /healthz` (liveness), `GET /readyz` (database ping)

Create an org and push a bundle:

```bash
curl -s -X POST localhost:8787/v1/signup -H 'content-type: application/json' \
  -d '{"orgName":"Acme","email":"dev@acme.test"}'
# → { organization, project, apiKey: { key: "rc_live_…" } }   (the key is shown once)

ROLECALL_API_URL=http://localhost:8787 ROLECALL_API_KEY=rc_live_… npx rolecall push .rolecall/runs/<run-id>
# or: rolecall run --push
```

To keep data between restarts use `DATABASE_URL=pglite://./.data/pglite`. For a real Postgres 17:
`docker compose up --build` from `apps/api/` (API on 127.0.0.1:8787; Postgres stays on the compose network).

## Endpoints (prefix `/v1`)

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| POST | `/signup` | none (rate-limited) | org on `free`, `default` project, admin key returned once |
| GET | `/organization` | any key | |
| GET/POST | `/projects` | read / admin | POST is limited by plan (402) |
| GET | `/projects/:id` | read | |
| GET/POST | `/api-keys` | admin | keys may be bound to one project (`projectId`) |
| DELETE | `/api-keys/:id` | admin | revoke |
| POST | `/runs` | `runs:write` | body `{manifest, results, events, signature?}` (raw file texts, ≤5 MB); 201 new, 200 duplicate, 422 verification failed, 402 quota |
| GET | `/runs` | `runs:read` | `{ runs: RunListItem[], nextCursor }`; filters `project, suite, branch, status, limit, cursor` |
| GET | `/runs/:id` | `runs:read` | `RunDetail` (fresh verification + baseline vs previous run on the default branch) |
| DELETE | `/runs/:id` | admin | does not refund quota |
| GET | `/billing` | admin | plan, usage this month, limits |
| POST | `/billing/checkout` | admin | Stripe Checkout URL; 501 `billing_disabled` without Stripe |
| POST | `/billing/webhook` | Stripe signature | idempotent per event id |

Errors are always `{ "error": { "code", "message", "details?" } }`.

## Configuration

See [`.env.example`](.env.example). All variables are validated at boot (`src/config/env.ts`); invalid config exits
with every problem listed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `pglite://memory` | `pglite://memory`, `pglite://<dir>` or a `postgres://` connection string |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | listen address |
| `PUBLIC_URL` | `http://localhost:8787` | run links and Stripe redirect URLs |
| `LOG_LEVEL` | `info` | pino level; `authorization` and `stripe-signature` headers are redacted |
| `CORS_ORIGINS` | empty (CORS off) | comma-separated dashboard origins |
| `TRUST_PROXY` | `false` | `true` behind ALB/Fly/Render so rate limits see the client IP |
| `RATE_LIMIT_MAX` / `SIGNUP_RATE_LIMIT_MAX` | `600`/min / `10`/h | per key (or IP) / per IP |
| `MIGRATE_ON_BOOT` | `true` | Postgres only; PGlite always migrates |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_ASSURANCE` | unset | billing |

## Database and migrations

Schema: `src/db/schema.ts`. SQL migrations are generated into `drizzle/` and committed:

```bash
pnpm --filter @rolecall/api db:generate   # after editing schema.ts
node apps/api/dist/db/migrate.js          # apply (also runs at boot unless MIGRATE_ON_BOOT=false)
```

## Tests

```bash
pnpm vitest run apps/api
```

Tests build the app with `buildApp()` on in-memory PGlite and drive it with `app.inject` (no network). Bundles are
generated in the test with `runSuite` + `writeBundle` from `@rolecall/core`, so the upload path is exercised with real
hashes; Stripe webhooks are signed with `Stripe.webhooks.generateTestHeaderString`.

## Deploying

The image is built from the repo root: `docker build -f apps/api/Dockerfile -t rolecall-api .`
(multi-stage, `node:22-slim`, runs as the non-root `node` user, `HEALTHCHECK` on `/healthz`).

**AWS ECS/Fargate.** Push the image to ECR; one Fargate service behind an ALB (target group health check `/readyz`).
Postgres on RDS 17 (Multi-AZ for paid tiers). Secrets (`DATABASE_URL`, Stripe keys) from Secrets Manager into the task
definition. Set `TRUST_PROXY=true`, `MIGRATE_ON_BOOT=false`, and run `node dist/db/migrate.js` as a one-off ECS task in
the deploy pipeline before rolling the service. SIGTERM triggers a graceful drain (10 s budget; set the ECS
`stopTimeout` ≥ 15 s).

**Fly.io / Render.** Deploy the same Dockerfile; attach managed Postgres; set `TRUST_PROXY=true`; use `/healthz` for
the HTTP check and a release command (`node dist/db/migrate.js`) for migrations.

**Stripe.** Create two recurring prices, set `STRIPE_PRICE_TEAM` / `STRIPE_PRICE_ASSURANCE`, and point a webhook
endpoint at `https://<host>/v1/billing/webhook` with `checkout.session.completed`,
`customer.subscription.updated` and `customer.subscription.deleted`.

Never run with PGlite in production: it is single-process and in-memory by default.
