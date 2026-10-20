# PRD: Rolecall MVP

Status: building, 2026-10-20. Founder approved the product on 2026-10-19. **Validation gap:** zero buyer interviews and no
commercial signal yet (playbook §11). The MVP doubles as the discovery demo.

## Problem
Teams shipping tool-using LLM agents can't show, before a deploy, that a role is unable to make the agent perform an action
that role isn't allowed to do. Evidence of pain: 53% of 445 organizations saw agents exceed intended permissions (Cloud Security Alliance study commissioned by Zenity, April 2026); quality is the top production blocker for 32% of 1,340 respondents (LangChain State of Agent Engineering).

## ICP
TypeScript/Node teams (10–500 people) running an AI SDK agent in production. User: the engineer who owns the agent and CI.
Buyer: Head of Eng/CTO; the security/GRC lead co-signs.

## Jobs to be done
1. "Fail CI when a prompt, model or tool change lets a role cause an action it must not."
2. "Hand a security reviewer a file showing what was tested and what happened."
3. "Know whether our authorization or only the model is protecting a dangerous tool."

## Non-goals (MVP)
Generic quality/accuracy evals, tracing/observability, LLM-generated red-teaming, Python, compliance certification claims.

## P0 (built)
Suite DSL with validation · direct probes · scenario runner with per-call layer classification · model-only-defense check ·
state diff · record/replay cassettes with network guard · Vercel AI SDK v7 adapter + `scriptedModel` · redaction · evidence
bundle (hash chain, Ed25519) + verify · baseline regressions · console, JUnit, Markdown and HTML reports · local dashboard ·
GitHub Action · demo · landing page · Cloud API (multi-tenant ingest, history, plans, Stripe).

## P1
PR comments, hosted dashboard login (cloud mode of `apps/ui`), OpenAI Agents SDK JS and Mastra adapters, MCP tool interception,
Postgres state helper, LLM-simulated users (never part of the deterministic gate), retention jobs.

## Metrics
- **Activation:** first suite run with ≥1 policy rule (local) / first bundle uploaded (Cloud).
- **Retention:** projects with ≥1 uploaded run in each of 3 consecutive weeks.

## Release gates
`pnpm build && pnpm typecheck && pnpm lint && pnpm test` green; demo CI job green; `docs/acceptance-tests.md` all covered;
founder confirms license and public repo before any npm publish.

## Risks
Copyable wedge (Promptfoo/LangWatch could add declarative matrices); consolidation (OpenAI–Promptfoo); AI SDK API churn
(v7 now, adapter isolates it); buyers expecting SOC 2 before using Cloud (mitigated: OSS runs locally, Cloud is optional).
