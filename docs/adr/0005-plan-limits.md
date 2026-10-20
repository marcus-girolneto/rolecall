# ADR 0005: Plan limits and billing

- Status: accepted (prices are hypotheses)
- Date: 2026-10-19

## Context

The CLI is free and open source; the Cloud is how Rolecall makes money. Limits must be enforced reliably, be easy to
change while pricing is being discovered, and not depend on Stripe being reachable.

## Decision

- Plans are defined in code (`src/modules/billing/plans.ts`), not in the database:

  | Plan | Price (hypothesis) | Projects | Runs / month | Retention |
  | --- | --- | --- | --- | --- |
  | free | US$0 | 1 | 100 | 14 days |
  | team | US$99/mo | 10 | 5,000 | 180 days |
  | assurance | US$399/mo | unlimited | 50,000 | 3 years, signed-evidence export |

- An org stores only its plan id. Unknown ids degrade to `free`.
- Run quota: `usage_counters(org_id, period=YYYY-MM UTC)` incremented with a single conditional upsert
  (`… ON CONFLICT DO UPDATE SET runs = runs + 1 WHERE runs < limit`), so concurrent uploads cannot overshoot. Duplicate
  uploads are free; deleting a run does not refund quota. Over the limit → `402 plan_limit_reached` with an upgrade hint.
- Project limit checked on project creation → 402.
- Stripe Checkout for upgrades (`POST /v1/billing/checkout`, 501 `billing_disabled` when Stripe is not configured).
  Plan changes come only from verified webhooks (`checkout.session.completed`, `customer.subscription.updated|deleted`),
  verified against the raw request body, and made idempotent with a `processed_events` table.

## Consequences

- Changing a price or limit is a code change and deploy, which is acceptable while pricing is being validated.
- Stripe outages do not block ingest; they only delay upgrades.
- Retention is declared per plan but not yet enforced by a purge job (follow-up).
- Downgrades take effect immediately on `customer.subscription.deleted`; existing projects over the new limit are kept
  but no new ones can be created.
