# ADR 0003 — API key authentication model

- Status: accepted
- Date: 2026-10-19

## Context

The first clients are the CLI in CI pipelines and the dashboard. Both need a simple bearer credential. A leaked CI key
should have a small blast radius, and the database must never hold usable secrets.

## Decision

- Keys look like `rc_live_<40 base32 chars>` (~200 bits). The prefix makes them recognisable to secret scanners.
- Only `sha256(key)` and an 8-character display prefix are stored. A fast hash is appropriate because keys are
  high-entropy random values, not passwords. The plaintext is returned exactly once at creation.
- Scopes: `runs:write` (ingest), `runs:read` (history), `admin` (keys, projects, billing, delete). `admin` implies all.
- A key may be **bound to one project**: CI ingest keys cannot read or write other projects. Org-wide keys choose the
  project with `?project=` (or the org's only project).
- Revocation sets `revoked_at`; revoked keys are rejected with 401 immediately. `last_used_at` is updated at most once a
  minute per key.
- Wrong-tenant resources return 404, not 403, so ids from other orgs are never confirmed.
- Rate limiting is keyed by a hash of the credential (falling back to IP), and signup is limited per IP.

## Consequences

- No user accounts or sessions yet: the dashboard uses a read key. Human login (OAuth/SSO) will add a session layer that
  produces the same `AuthContext`, so services do not change.
- Keys cannot be recovered, only rotated.
