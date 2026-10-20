# Acceptance tests (P0)

Every MVP acceptance criterion is covered by an automated test. Run `pnpm test`.

| # | Criterion | Test |
|---|---|---|
| 1 | Planted bug → exit non-zero, reports `support × refundInvoice (above limit) → expected deny, got executed` with state diff | `examples/invoice-agent/test/cli.e2e.test.ts` "catches the planted refund bug…" |
| 2 | Fixed → passes; revert with `--baseline` → regression | same test (fixed run exit 0, `--baseline latest` reports `regressed`) |
| 3 | Model refuses + weakened authz → pass with `model_only_defense` warning | `packages/core/test/runner.test.ts` "warns with model_only_defense…"; CLI: "shows the model-only defense warning…" (`--strict` → exit 1) |
| 4 | Replay makes no network calls; two replay runs identical | `runner.test.ts` "blocks network in replay mode…", "is deterministic…"; `packages/ai-sdk/test/adapter.test.ts` "records model calls once, then replays them offline…" (0 model calls) |
| 5 | `verify` passes fresh, fails after a one-byte change to any file or the manifest | `packages/core/test/evidence.test.ts` "verifies a fresh bundle and fails after a one-byte change…"; CLI tamper test |
| 6 | Planted secrets never appear in the bundle | `evidence.test.ts` "never writes planted secrets to disk" |
| 7 | Live execution refused without target declaration and env flag | `runner.test.ts` "refuses non-memory targets…", "rejects production targets…" |

Also covered: Ed25519 signing with a pinned trusted key, JUnit output, custom `isDenied`, state changes after a denial,
non-authorization errors reported as `error`, and probe args validated against the tool's input schema.
