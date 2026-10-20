# ADR 0004: Re-verify every evidence bundle on the server

- Status: accepted
- Date: 2026-10-19

## Context

Rolecall's value is evidence: "this agent was tested against this permission matrix, with these results". If the Cloud
trusted whatever the client said, an edited `results.json` (for example, flipping a fail to pass) would be displayed as
genuine and could end up in an audit.

## Decision

- Uploads carry the raw file texts (`manifest`, `results`, `events`, `signature?`), exactly as written by the CLI.
- The API runs `verifyBundleFiles` from `@rolecall/core` (the same code as `rolecall verify`): file hashes, manifest
  root hash, and Ed25519 signature when present. Any problem → `422 invalid_bundle` with the list of problems.
- After integrity, structural checks (zod) and consistency checks (`manifest.summary == results.summary`, suite hash).
- The raw texts are stored unchanged so anyone can re-verify later; `GET /v1/runs/:id` recomputes verification on every
  read instead of trusting a stored flag.
- Dedupe by `(project_id, root_hash)`: re-uploading the same bundle is idempotent and returns the existing id.

## Consequences

- A bundle that verifies proves the files were not modified after the manifest was sealed. Without a signature it does
  not prove *who* produced it; signed bundles carry the key id, and trusted-key pinning per project is future work.
- Verification costs a few sha256 passes over ≤5 MB per request; negligible compared with network time.
- Storing texts in Postgres is simple now; moving them to object storage later keeps the same verification flow.
