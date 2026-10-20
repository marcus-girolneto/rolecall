# ADR 0001 — Layered, modular architecture for the Cloud API

- Status: accepted
- Date: 2026-10-19

## Context

Rolecall Cloud is the paid product. It will grow (PR comments, signed-evidence export, retention jobs, SSO) and will be
worked on by several people and agents. The founder asked for a clean, scalable design that keeps tenant isolation and
billing rules obvious and testable.

## Decision

Feature modules (`organizations`, `projects`, `api-keys`, `runs`, `billing`, `health`), each split into
`routes → controller → service → repository` with `schemas` alongside.

- Routes only declare zod schemas, scopes and bind a controller. Schemas double as validation and OpenAPI.
- Controllers translate HTTP to service calls and back. No business rules.
- Services own business rules and depend on repository **interfaces**, injected through constructors.
- Repositories are the only code that imports Drizzle. Every method that reads tenant data takes `orgId` and filters by
  it, so isolation holds by construction rather than by convention in each handler.
- `buildApp(deps)` in `src/app.ts` is the single composition root; there are no global singletons. Tests build the app
  with an in-memory database and exercise it through `app.inject`.
- Cross-cutting concerns (errors, auth, docs, security headers, rate limits) are Fastify plugins.

## Consequences

- More files per feature than a single-file handler style; each is small and has one reason to change.
- Services can be unit-tested with fake repositories; the HTTP tests cover the wiring end to end.
- A few system-level lookups are intentionally not tenant-scoped (API key by hash, org by Stripe customer id); they are
  named and documented as such in the repository interfaces.
- Splitting a module into its own service later is mechanical: its service already depends only on interfaces.
