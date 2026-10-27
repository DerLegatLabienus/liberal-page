# Node.js October 2026 security upgrade — design

Issue: #54. Tier: **risky** (deploy and CI config: `render.yaml`, `.github/workflows/`).

## Problem

Node.js 22.23.4 (released 2026-10-20, announced 2026-10-21) fixes 10 CVEs. The worst is CVE-2026-111497 ("Node2Shell"), an
out-of-bounds write in the bundled Brotli decoder that allows remote code execution. Built-in
`fetch` and Express 5 / body-parser decode Brotli automatically. We pinned only the major (`"22"`),
so CI, Render and local machines could keep running a vulnerable 22.x. Separately,
`npm audit --omit=dev` listed 26 production findings (1 critical, 15 high).

## Decision

- Pin the exact patched release `22.23.4` wherever a version is chosen: `render.yaml`
  `NODE_VERSION`, `node-version` in `ci.yml` / `deploy.yml` / `test.yml`, and `.nvmrc`. Raise
  `engines.node` to `>=22.23.4` so an older local runtime gets a warning from npm.
- Stay on Node 22 (the issue rules out a move to 24/26).
- Run `npm audit fix` without `--force`. That changes only `package-lock.json`. Every direct dependency
  stays inside its existing range. Some transitive packages did cross a major: `shadcn` 4.7 → 4.22
  now requires `zod` 4, so the hoisted `zod` (3 → 4) and `@hono/node-server` (1 → 2) moved. Our code
  imports neither. `@anthropic-ai/sdk` accepts `zod` `^3.25 || ^4`.
- Leave fixes that need a major version for a follow-up issue:
  - production: `tailwindcss` 4 (3 moderate findings: `tailwindcss`, `postcss-nested`,
    `postcss-selector-parser`)
  - dev only: `vitest`/`@vitest/*`/`tinypool` 5, `vite` 8, `drizzle-kit`

## Result

- `npm audit --omit=dev`: 26 findings → 3 moderate, with 0 high and 0 critical.
- Full `npm audit`: 40 → 13. The remaining high and critical findings are all dev-only test and
  build tooling (`vitest` 3 critical, `vite` 1 high). None of it runs on Render.
- Supply-chain check: the lockfile has no compromised version from the keyv/cacheable, node-ipc
  or Mastra/easy-day-js campaigns.

## Verification

The gate (1307 tests, tsc, lint, build) and `npm run smoke` were run on a real Node v22.23.4
binary after a clean `npm ci`. The smoke run used a pglite socket server as Postgres.

## Rollout and rollback

`render.yaml` only takes effect if the service is synced from the Blueprint. If `NODE_VERSION`
was set by hand in the Render dashboard, change it there to `22.23.4` too.

Render builds with `npm ci` on `NODE_VERSION`, and migrations are untouched. The health-check gate
keeps the previous build serving if the new one fails to answer. To roll back, revert the commit.
