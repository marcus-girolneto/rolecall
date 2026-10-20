# @rolecall/ui

The Rolecall dashboard: run list, permission matrix (roles × tools), scenarios with defense layers, findings,
evidence integrity and baseline comparison. React 19 + Tailwind 4, built into **one self-contained file**
(`dist/index.html`) that the CLI serves (`rolecall ui`) and embeds in static reports (`rolecall report --format html`).

## Runtime contract

- `index.html` contains `<!--rolecall:bootstrap-->` in `<head>`, before the app script. The CLI replaces it with
  `<script>window.__ROLECALL__=…</script>` (a `DashboardBootstrap` from `@rolecall/core`).
- `mode: 'static'` → `runs` and `details` are embedded; nothing is fetched.
- `mode: 'local' | 'cloud'` → `GET ${apiBase}/runs` and `GET ${apiBase}/runs/:id`.
- Hash routing: `#/runs/:id`, `#/runs/:id/test/:testId` (works from `file://`).
- `@rolecall/core` is imported for types only (aliased to `packages/core/src`), so no build of core is needed.

## Develop

```sh
pnpm --filter @rolecall/ui dev        # loads fixtures/bootstrap.json when no data is injected (dev only)
pnpm --filter @rolecall/ui typecheck
pnpm --filter @rolecall/ui build      # → dist/index.html
pnpm --filter rolecall build          # copies the dashboard into the CLI
```

The fixture is loaded through a dynamic import behind `import.meta.env.DEV`, so it never ships in production.
Theme: dark by default, light via the toggle or `prefers-color-scheme: light` (stored in `localStorage` when available).
