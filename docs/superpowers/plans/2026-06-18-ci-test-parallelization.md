# CI Test Parallelization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the deploy-path CI wall-clock by (B) migrating the test pglite once and loading a snapshot per file instead of replaying 20 migrations × 69 files, and (A) sharding `npm test` across 3 parallel jobs via a reusable workflow.

**Architecture:** A vitest `globalSetup` migrates a throwaway pglite once and dumps it to a temp file. The test-mode DB client loads that snapshot (`loadDataDir`) instead of starting empty, and the per-file harness skips migration when the snapshot exists. CI test logic moves into one reusable workflow (`workflow_call`) consumed by both `ci.yml` and `deploy.yml`, running a 3-way `--shard` matrix.

**Tech Stack:** Vitest, `@electric-sql/pglite@0.4.6` (`dumpDataDir`/`loadDataDir`), Drizzle pglite migrator, GitHub Actions reusable workflows + matrix.

**Spec:** `docs/superpowers/specs/2026-06-18-ci-test-parallelization-design.md`

---

## File Structure

- Create `server/db/pglite-snapshot.ts` — single source of truth for the snapshot file path (node-builtin imports only; safe to import in production, used only in test).
- Create `tests/global-setup.ts` — migrate-once + dump snapshot; vitest globalSetup.
- Modify `vitest.config.ts` — register `globalSetup`.
- Modify `server/db/client.ts` — load snapshot in test mode.
- Modify `tests/server/db-harness.ts` — skip `runMigrations()` when snapshot present.
- Create `.github/workflows/test.yml` — reusable workflow: lint+typecheck job, 3-shard test matrix.
- Modify `.github/workflows/ci.yml` — call reusable workflow + build/smoke jobs.
- Modify `.github/workflows/deploy.yml` — replace test job with the reusable workflow.

---

## Task 1: Spike — confirm the pglite dump/load round-trip

**Files:** none committed (throwaway script).

- [ ] **Step 1: Write a throwaway spike script**

Create `/tmp/pglite-spike.mjs` (outside the repo):

```js
import { PGlite } from '@electric-sql/pglite'

const a = new PGlite()
await a.exec('CREATE TABLE t (id int); INSERT INTO t VALUES (42);')
const file = await a.dumpDataDir()
const buf = Buffer.from(await file.arrayBuffer())
console.log('dump bytes:', buf.length)

const b = new PGlite({ loadDataDir: new Blob([buf]) })
const res = await b.query('SELECT id FROM t')
console.log('loaded rows:', JSON.stringify(res.rows))
if (res.rows[0]?.id !== 42) throw new Error('round-trip FAILED')
console.log('round-trip OK')
```

- [ ] **Step 2: Run the spike from the repo root (so it resolves the installed pglite)**

Run: `node --experimental-vm-modules /tmp/pglite-spike.mjs` (or `cd` to repo root and `node /tmp/pglite-spike.mjs`)
Expected: prints `dump bytes: <n>`, `loaded rows: [{"id":42}]`, `round-trip OK`.

If the API differs (e.g. `loadDataDir` wants a `File` not a `Blob`, or `dumpDataDir` needs a compression arg), note the exact working call — later tasks use this confirmed pattern.

- [ ] **Step 3: Delete the spike**

Run: `rm /tmp/pglite-spike.mjs`
No commit.

---

## Task 2: Shared snapshot-path module

**Files:**
- Create: `server/db/pglite-snapshot.ts`

- [ ] **Step 1: Create the module**

```ts
import os from 'os'
import path from 'path'

/**
 * Path to the test suite's pre-migrated pglite snapshot. Written once by vitest
 * globalSetup (tests/global-setup.ts) and loaded by the test-mode DB client
 * (server/db/client.ts) so each test file starts from a migrated DB without
 * replaying every migration. Test-only — never read in production (the prod
 * client uses node-postgres). Imports are node builtins, so this file is safe
 * to import anywhere.
 */
export const PGLITE_SNAPSHOT_PATH = path.join(os.tmpdir(), 'liberal-page-pglite-test-snapshot.tar.gz')
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 3: Commit**

```bash
git add server/db/pglite-snapshot.ts
git commit -m "test(db): add shared pglite snapshot path module"
```

---

## Task 3: vitest globalSetup — migrate once and dump

**Files:**
- Create: `tests/global-setup.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Create the globalSetup**

`tests/global-setup.ts`:

```ts
import path from 'path'
import fs from 'fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../server/db/schema'
import { PGLITE_SNAPSHOT_PATH } from '../server/db/pglite-snapshot'

// Runs once per vitest invocation (i.e. once per CI shard), before any test file.
// Migrates a throwaway pglite, dumps the migrated data dir to a temp file, and
// removes it on teardown. Each test file then loads this snapshot instead of
// replaying all migrations (see server/db/client.ts + tests/server/db-harness.ts).
export default async function setup() {
  process.env.NODE_ENV = 'test'
  const pg = new PGlite()
  const db = drizzle(pg, { schema })
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'server/db/migrations') })

  const file = await pg.dumpDataDir()
  fs.writeFileSync(PGLITE_SNAPSHOT_PATH, Buffer.from(await file.arrayBuffer()))
  await pg.close()

  return async () => {
    fs.rmSync(PGLITE_SNAPSHOT_PATH, { force: true })
  }
}
```

- [ ] **Step 2: Register globalSetup in vitest.config.ts**

In `vitest.config.ts`, inside the `test: { ... }` object, add the `globalSetup` key next to `setupFiles`:

```ts
    setupFiles: ['./src/test-setup.ts'],
    globalSetup: ['./tests/global-setup.ts'],
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify the snapshot is produced (sanity, without wiring consumers yet)**

Run: `npx vitest run tests/unit --reporter=dot 2>&1 | tail -5`
Expected: unit tests pass. (globalSetup runs; if `dumpDataDir`/migrate throws, this fails here — fix before continuing.)

- [ ] **Step 5: Commit**

```bash
git add tests/global-setup.ts vitest.config.ts
git commit -m "test(db): migrate-once pglite snapshot via vitest globalSetup"
```

---

## Task 4: Load the snapshot in the test-mode DB client

**Files:**
- Modify: `server/db/client.ts`

- [ ] **Step 1: Add imports at the top of `server/db/client.ts`**

Add below the existing imports (both are node-builtin / plain-constant, safe in production):

```ts
import fs from 'fs'
import { PGLITE_SNAPSHOT_PATH } from './pglite-snapshot'
```

- [ ] **Step 2: Use the snapshot in the test branch of `createDb()`**

Replace the test branch (currently lines ~12-19) with:

```ts
  if (process.env.NODE_ENV === 'test') {
    // createRequire gives a working `require` under ESM (tsx/Vite), so pglite —
    // a devDependency absent in production — is only loaded in test mode.
    const require = createRequire(import.meta.url)
    const { PGlite } = require('@electric-sql/pglite')
    const { drizzle: drizzlePglite } = require('drizzle-orm/pglite')
    // Load the pre-migrated snapshot written by tests/global-setup.ts when present,
    // so each test file starts migrated without replaying migrations. Falls back to
    // an empty instance (the harness then migrates) if no snapshot exists.
    const opts = fs.existsSync(PGLITE_SNAPSHOT_PATH)
      ? { loadDataDir: new Blob([fs.readFileSync(PGLITE_SNAPSHOT_PATH)]) }
      : {}
    return drizzlePglite(new PGlite(opts), { schema }) as unknown as DB
  }
```

(If Task 1 found `loadDataDir` needs a `File` rather than a `Blob`, use the confirmed wrapper here instead.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/db/client.ts
git commit -m "test(db): load pglite snapshot in test-mode client"
```

---

## Task 5: Skip per-file migration when the snapshot is present

**Files:**
- Modify: `tests/server/db-harness.ts`

- [ ] **Step 1: Replace the harness body**

`tests/server/db-harness.ts`:

```ts
import fs from 'fs'
import { runMigrations } from '../../server/db/migrate'
import { db } from '../../server/db/client'
import { PGLITE_SNAPSHOT_PATH } from '../../server/db/pglite-snapshot'

// The per-file in-memory pglite is created from the globalSetup snapshot when it
// exists (server/db/client.ts), so it is already migrated — skip runMigrations in
// that case. Fall back to migrating from scratch if there is no snapshot (e.g. the
// harness is used without globalSetup). Call once in beforeAll; the same `db` is
// shared across the file's tests.
export async function setupTestDb() {
  if (!fs.existsSync(PGLITE_SNAPSHOT_PATH)) await runMigrations()
  return db
}
```

- [ ] **Step 2: Run the full server suite to confirm correctness**

Run: `npx vitest run tests/server --reporter=dot 2>&1 | tail -8`
Expected: all server tests pass (same count as before — no failures, no "relation does not exist" errors).

- [ ] **Step 3: Commit**

```bash
git add tests/server/db-harness.ts
git commit -m "test(db): skip per-file migration when snapshot present"
```

---

## Task 6: Verify full suite + measure the Lever-B speedup

**Files:** none.

- [ ] **Step 1: Run the full suite and confirm green**

Run: `npm test 2>&1 | tail -6`
Expected: `Test Files 103 passed | 1 skipped`, `Tests 548 passed | 5 skipped` (counts must match pre-change; no new failures).

- [ ] **Step 2: Measure wall-clock**

Run: `/usr/bin/time -v npm test 2>&1 | grep -E "Elapsed|Duration" || (time npm test)`
Expected: noticeably faster than the pre-change baseline (~30s local → lower). Record the number in the commit message of Task 5 if not already, or just note it.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors (pre-existing react-refresh warnings are acceptable).

---

## Task 7: Reusable test workflow (lint/typecheck + 3-shard test matrix)

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create the reusable workflow**

`.github/workflows/test.yml`:

```yaml
name: test
on:
  workflow_call:

jobs:
  lint-typecheck:
    name: lint + type-check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit

  test:
    name: test (shard ${{ matrix.shard }}/3)
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - run: npm test -- --shard=${{ matrix.shard }}/3
```

- [ ] **Step 2: Validate YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: reusable test workflow with 3-shard vitest matrix"
```

---

## Task 8: Refactor ci.yml to call the reusable workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace ci.yml**

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: ["**"]
  pull_request:
    branches: ["**"]

jobs:
  test:
    uses: ./.github/workflows/test.yml

  build-and-smoke:
    name: build + smoke
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: liberal_dev
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres -d liberal_dev"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - name: Build
        run: npm run build
      - name: Smoke test — start server and hit /api/health
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/liberal_dev
        run: |
          npx tsx server/index.ts &
          SERVER_PID=$!
          sleep 5
          curl -f http://localhost:3001/api/health
          CURL_EXIT=$?
          kill $SERVER_PID 2>/dev/null || true
          exit $CURL_EXIT
```

(lint + type-check + tests now live in the reusable workflow; `build-and-smoke` runs in parallel with it so PR feedback is fast.)

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: use reusable test workflow; keep build+smoke job"
```

---

## Task 9: Refactor deploy.yml test job to the reusable workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Replace the `test` job with a reusable-workflow call**

In `.github/workflows/deploy.yml`, replace the entire `test:` job (the one running checkout/setup/install/lint/tsc/test) with:

```yaml
  test:
    uses: ./.github/workflows/test.yml
```

Leave the `build` job (`needs: test`, with `VITE_*` secrets and the Pages artifact upload) and the `deploy` job (`needs: build`) unchanged. The workflow-level `permissions` (`pages: write`, `id-token: write`) and `concurrency` blocks stay as-is.

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy gates on reusable sharded test workflow"
```

---

## Task 10: Push and verify CI behavior + timing

**Files:** none.

- [ ] **Step 1: Push the branch and open/refresh CI**

Run: `git push`
Then watch the runs:
Run: `gh run list --limit 4`

- [ ] **Step 2: Confirm structure and green**

Verify: `ci` shows `lint + type-check`, three `test (shard i/3)` jobs, and `build + smoke`; `deploy` shows the three shards → `build` → `deploy`. All green.
Run: `gh run view <deploy-run-id> --json jobs -q '.jobs[] | "\(.name): \(.conclusion)"'`
Expected: every job `success`.

- [ ] **Step 3: Compare timing to baseline**

Run: `gh api repos/DerLegatLabienus/liberal-page/actions/runs/<deploy-run-id>/jobs | python3 -c "import sys,json,datetime as dt; d=json.load(sys.stdin); [print(j['name'], (dt.datetime.fromisoformat(j['completed_at'].replace('Z','+00:00'))-dt.datetime.fromisoformat(j['started_at'].replace('Z','+00:00'))).total_seconds(),'s') for j in d['jobs']]"`
Expected: each test shard well under the old 80s; deploy critical path materially below the ~155–175s baseline. Record the result.

---

## Task 11 (optional): Cache node_modules to cut repeated `npm ci`

**Files:**
- Modify: `.github/workflows/test.yml` (and the install steps in `ci.yml` build-and-smoke / `deploy.yml` build if desired)

- [ ] **Step 1: Add a node_modules cache step before `npm ci` in each job**

Insert after `actions/setup-node@v4` and before `run: npm ci`:

```yaml
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: nm-${{ runner.os }}-node22-${{ hashFiles('package-lock.json') }}
```

Keep `npm ci` (it is a no-op-ish fast verify on a cache hit; `npm ci` still runs to guarantee a clean tree).

- [ ] **Step 2: Validate YAML, push, and confirm install time drops on the second run**

Run: `python3 -c "import yaml; [yaml.safe_load(open(f)) for f in ['.github/workflows/test.yml']]; print('yaml ok')"` then `git commit -am "ci: cache node_modules to speed installs" && git push`
Expected: on the second run, install steps are faster on cache hit; all jobs still green.

---

## Self-Review

- **Spec coverage:** Lever B → Tasks 2–6; Lever A (shard matrix) → Task 7; reusable workflow → Tasks 7–9; optional node_modules cache → Task 11; verification → Tasks 6 & 10. All spec sections covered.
- **Type consistency:** `PGLITE_SNAPSHOT_PATH` is defined once (Task 2) and imported identically in globalSetup (Task 3), client (Task 4), and harness (Task 5). `setupTestDb()` signature unchanged (still returns `db`), so existing `beforeAll` callers need no edits.
- **Fallback preserved:** harness still migrates from scratch when no snapshot exists, so the change is safe if globalSetup is ever bypassed.
