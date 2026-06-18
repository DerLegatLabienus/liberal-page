# CI Test Parallelization — Design

**Date:** 2026-06-18
**Status:** Approved (design); pending spec review

## Context / Problem

CI takes too long on the path to deployment. Measured on recent runs:

- `deploy.yml` critical path: **~155–175s** (Test → Build → Deploy, run serially).
- Per-step breakdown of the gating **Test** job: setup+`npm ci` ~19s, lint ~4s, type-check ~0s, **`npm test` ~80s**.
- Build job ~44s (mostly provisioning + `npm ci`), Deploy ~8s.

So a single step — `npm test` at **80s** — dominates and blocks Build/Deploy.

Two independent reasons it is slow:

1. **Core-bound.** GitHub-hosted `ubuntu-latest` runners have ~2 vCPUs, so vitest's worker pool can't spread out. The same suite runs ~30s on a multi-core dev machine.
2. **Per-file DB setup overhead.** All 69 `tests/server/**` files call `setupTestDb()` (`tests/server/db-harness.ts`), which runs `runMigrations()` against a **per-file** in-memory pglite — replaying all **20** migrations 69 times.

Additional waste: both `ci.yml` (all branches) and `deploy.yml` (master) run the full suite, duplicating test logic in two places.

Repo is **public**, so GitHub Actions minutes are free — extra parallel jobs cost only YAML complexity, not money.

## Goals

- Cut the deploy-path wall-clock, primarily by shrinking the 80s test step.
- Fix the root-cause per-file migration overhead (also speeds local `npm test`).
- Keep test isolation semantics (each server test file sees a clean, migrated DB; no cross-test state).
- Single source of truth for the CI test logic (no drift between workflows).

## Non-goals

- Paid larger runners (doesn't help local dev; costs money).
- Sharing one pglite across files via `isolate: false` (risks cross-test state — rejected).
- Reworking the test framework or migrating off pglite.

## Design

### Lever B — Snapshot the migrated DB once (root cause)

Replace "replay 20 migrations × 69 files" with "migrate once, load a snapshot per file."

- Add a vitest **`globalSetup`** that:
  1. Creates a throwaway PGlite, runs `runMigrations()` against it once.
  2. Calls `dumpDataDir()` to serialize the migrated state.
  3. Writes the snapshot to a temp file (node `os.tmpdir()`), exposing its path via an env var (e.g. `PGLITE_SNAPSHOT`).
- `server/db/client.ts` (test mode only): when `PGLITE_SNAPSHOT` is set, construct PGlite with `{ loadDataDir: <snapshot blob> }` instead of an empty instance. In node, read the file and wrap in a `Blob`.
- `tests/server/db-harness.ts`: `setupTestDb()` no longer calls `runMigrations()` when a snapshot was loaded (schema is already present). Keep a fallback that migrates if no snapshot is available, so the harness still works when run without globalSetup.

Each test file still gets its **own** fresh, isolated PGlite — just pre-migrated from the snapshot rather than migrated from scratch. No cross-test state.

**Feasibility:** confirmed `@electric-sql/pglite@0.4.6` exposes `dumpDataDir`/`loadDataDir`. The implementation plan must include a round-trip verification spike (dump → load → query the seeded schema) before wiring it everywhere.

### Lever A — Shard tests across parallel jobs

- Run vitest with `--shard=<i>/<N>` in a job **matrix**, recommended **N=3**.
- A fan-in: the Build job `needs:` all shard jobs, so deploy still waits for the whole suite.
- N capped at 3 because each job pays a fixed floor (~15–20s runner provisioning + ~12s `npm ci`); beyond ~3 shards the floor dominates and returns diminish.

### Glue — Reusable workflow (DRY)

- Extract the test logic (checkout, setup-node, `npm ci`, lint, type-check, sharded `npm test`) into a **reusable workflow** invoked via `workflow_call`.
- Both `ci.yml` and `deploy.yml` call it, so the matrix and steps live in exactly one file and cannot drift.
- On a master push both workflows still run the suite (parallel, free); cross-workflow dedup via `workflow_run` is intentionally out of scope (changes trigger semantics, fragile).

### Optional add-on — node_modules cache

- Cache `node_modules` keyed on `package-lock.json` hash to cut the repeated ~12s `npm ci` per job. Lower priority; include only if it lands cleanly.

## Expected outcome

- Test step ~80s → ~35–40s warm (Lever B), then ~3-way sharded → per-shard ~limited by the provisioning/install floor.
- Deploy critical path roughly **halved** (~80–95s from ~155–175s). Treated as a target, not a guarantee; the plan should re-measure after each lever.

## Risks & mitigations

- **Snapshot round-trip incompatibility.** Mitigate with a verification spike before broad wiring; keep the migrate-from-scratch fallback in `setupTestDb()`.
- **Snapshot staleness.** The snapshot is rebuilt every run by `globalSetup` from current migrations — no committed artifact to go stale.
- **Over-sharding.** Cap N=3; re-measure.
- **Reusable-workflow secret/permission passing.** `deploy.yml`'s build needs `VITE_*` secrets; ensure the reusable workflow only owns the test phase, leaving build/deploy in `deploy.yml`.

## Verification

- Local: `npm test` wall-clock before/after Lever B (expect a large drop); full suite still green (548 passing).
- CI: compare `deploy.yml` job/step timings before/after via `gh run view`; confirm all shards pass and Build still gates on them.
- Correctness: server tests still see isolated, migrated DBs; no new flakes across a few runs.

## Critical files

- `vitest.config.ts` (add `globalSetup`)
- new `tests/global-setup.ts` (migrate once + dump)
- `server/db/client.ts` (test-mode `loadDataDir`)
- `tests/server/db-harness.ts` (skip per-file migrate when snapshot present)
- `.github/workflows/` — new reusable test workflow; `ci.yml` and `deploy.yml` call it with a shard matrix
