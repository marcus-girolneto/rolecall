# ADR 0006 — Everything open source

- Status: accepted (2026-10-20), supersedes the earlier open-core decision

## Context
An earlier version kept the hosted Cloud API, the website and the brand proprietary (open core). The founder decided
the whole project should be open source: adoption and trust matter more at this stage than protecting the server code,
and a security tool earns trust by being inspectable end to end.

## Decision
- Everything in this repository is Apache-2.0: SDK, CLI, dashboard, GitHub Action, Cloud API, website and examples.
- Revenue, if any, comes from operating the hosted Cloud (convenience, retention, support) and from design-partner
  pilots, not from closed code.
- Market research and sales material are not part of the repository.
- Notes about suspected vulnerabilities in third-party projects never enter the repository (see
  `docs/benchmark/README.md`, disclosure policy).

## Consequences
- Anyone can self-host the Cloud API. The hosted offering competes on operations, not on code.
- Contributions are welcome under Apache-2.0 with a DCO sign-off.
