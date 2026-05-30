# Local Database Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dev server run against real Postgres — local Docker (default, offline) or Neon — selected purely by `DATABASE_URL`, with the local Docker DB runnable ephemeral or preloaded.

**Architecture:** Consolidate the Postgres driver to a single `node-postgres` (`pg`) client (replacing `@neondatabase/serverless`), so one driver reaches both local Docker and Neon. Add a one-service `docker-compose.yml` and npm scripts for the ephemeral/preloaded workflows. Tests stay on in-memory pglite, untouched.

**Tech Stack:** `pg` (node-postgres), `drizzle-orm/node-postgres`, Drizzle Kit, Docker Compose, Postgres 17, Node `--env-file`, tsx, Vitest, pglite (test only).

**Spec:** `docs/superpowers/specs/2026-05-30-local-db-env-design.md`

**Prerequisite note:** This builds on the Phase 1 DB migration branch (`feat/db-migration-phase1`, PR #2) and supersedes its `neon-serverless` driver. Implement on that branch (folding into PR #2) unless told otherwise.

---

## File Structure

**Modified:**
- `server/db/client.ts` — driver seam: pglite (test) / node-postgres (dev+prod)
- `server/db/migrate.ts` — node-postgres migrator for the non-test path
- `package.json` — deps swap; `db:up`/`db:down`/`db:reset` scripts; `--env-file=.env` on `dev:server`
- `.env.example` — local Docker + Neon connection strings
- `.gitignore` — ensure `.env` ignored
- `CLAUDE.md` — local dev DB section

**Created:**
- `docker-compose.yml` — single Postgres 17 service with a named volume

**Untouched:** all repositories, routes, schema, `scripts/seed-db.ts`, and every test (pglite path unchanged).

---

## Task 1: Swap Postgres driver to node-postgres

**Files:**
- Modify: `package.json` (deps)
- Modify: `server/db/client.ts`
- Modify: `server/db/migrate.ts`

- [ ] **Step 1: Confirm the only consumers of the old driver**

Run: `grep -rn "neondatabase/serverless\|neon-serverless" server/ scripts/ tests/ --include="*.ts"`
Expected: matches ONLY in `server/db/client.ts` and `server/db/migrate.ts`. If anything else references it, stop and report — those callers need handling too.

- [ ] **Step 2: Swap dependencies**

Run:
```bash
npm uninstall @neondatabase/serverless
npm install pg
npm install -D @types/pg
```
Expected: `pg` in dependencies, `@types/pg` in devDependencies, `@neondatabase/serverless` gone. `drizzle-orm` already provides the `drizzle-orm/node-postgres` entrypoint (no separate install).

- [ ] **Step 3: Rewrite `server/db/client.ts`**

```ts
import { createRequire } from 'module'
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

export type DB = NodePgDatabase<typeof schema>

function createDb(): DB {
  if (process.env.NODE_ENV === 'test') {
    // createRequire gives a working `require` under ESM (tsx/Vite), so pglite —
    // a devDependency absent in production — is only loaded in test mode.
    const require = createRequire(import.meta.url)
    const { PGlite } = require('@electric-sql/pglite')
    const { drizzle: drizzlePglite } = require('drizzle-orm/pglite')
    return drizzlePglite(new PGlite(), { schema }) as unknown as DB
  }
  // One driver for both local Docker and Neon. SSL is driven by the connection
  // string (the Neon URL carries `?sslmode=require`; the local URL carries none).
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  return drizzleNodePg(pool, { schema })
}

export const db: DB = createDb()
```

- [ ] **Step 4: Rewrite `server/db/migrate.ts`**

```ts
import path from 'path'
import { db } from './client'

const MIGRATIONS_DIR = path.join(process.cwd(), 'server/db/migrations')

export async function runMigrations(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR })
    return
  }
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}
```

- [ ] **Step 5: Verify the test path is unaffected (hard gate)**

Run: `npm test`
Expected: all tests pass (247 passed, 5 skipped) — the pglite path is unchanged, so the whole repository suite must stay green.

- [ ] **Step 6: Type check + lint**

Run: `npx tsc --noEmit`
Expected: PASS. The `DB` type is now `NodePgDatabase<typeof schema>`; repositories use only the query API so they compile unchanged.
Run: `npx eslint server/db/client.ts server/db/migrate.ts`
Expected: clean.

- [ ] **Step 7: Sanity-check the test-mode client still constructs**

Run:
```bash
NODE_ENV=test npx tsx -e "import('./server/db/migrate.ts').then(m => m.runMigrations()).then(() => { console.log('pglite migrate OK'); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })"
```
Expected: `pglite migrate OK`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json server/db/client.ts server/db/migrate.ts
git commit -m "feat(db): use node-postgres driver for local Docker + Neon"
```

---

## Task 2: Local Docker Postgres + lifecycle scripts

**Files:**
- Create: `docker-compose.yml`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: liberal_dev
    ports:
      - "5432:5432"
    volumes:
      - liberal_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d liberal_dev"]
      interval: 3s
      timeout: 3s
      retries: 10

volumes:
  liberal_pgdata:
```

> Postgres 17 matches Neon's current default major. Verify Neon's default major at the Neon console / docs; if it differs, pin the `image` tag to match.

- [ ] **Step 2: Add lifecycle scripts to `package.json`**

In `"scripts"`, add:
```json
"db:up": "docker compose up -d db",
"db:down": "docker compose down",
"db:reset": "docker compose down -v && docker compose up -d db"
```
(`db:generate` and `db:seed` already exist from Phase 1.)

- [ ] **Step 3: Verify compose file is valid**

Run: `docker compose config`
Expected: prints the resolved config with the `db` service and `liberal_pgdata` volume, no errors. (This validates YAML without starting anything; it does not require pulling the image.)

- [ ] **Step 4: (Operational, if Docker is available) Start the DB and confirm it accepts connections**

Run:
```bash
npm run db:up
# wait for healthy, then:
docker compose ps
```
Expected: the `db` service is running/healthy. If Docker is not available in this environment, skip this step — it is exercised in Task 4's integration check and is a developer-runtime concern, not a build gate.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml package.json
git commit -m "feat(db): add local Postgres docker-compose + lifecycle scripts"
```

---

## Task 3: Config wiring (.env, gitignore, dev:server)

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`
- Modify: `package.json` (`dev:server` script)

- [ ] **Step 1: Create `.env.example`**

```
# Local database connection. Copy this file to `.env` and pick ONE target.

# Local Docker Postgres (default — run `npm run db:up` first)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev

# Neon (uncomment to point local dev at the cloud DB instead)
# DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.neon.tech/DBNAME?sslmode=require
```

- [ ] **Step 2: Ensure `.env` is gitignored**

Check `.gitignore` for a `.env` entry:
Run: `grep -n "^\.env$\|^\.env\b" .gitignore`
If absent, append a line `.env` to `.gitignore`. (Do NOT ignore `.env.example` — it is committed.)
Verify: `git check-ignore .env` prints `.env` (ignored) and `git check-ignore .env.example` prints nothing (tracked).

- [ ] **Step 3: Load `.env` in the dev server script**

Confirm `tsx` forwards Node's `--env-file`:
Run: `node --version` (expect ≥ v20.6 — project runs Node 21.x, so `--env-file` is supported).
In `package.json`, change the `dev:server` script from:
```json
"dev:server": "tsx watch server/index.ts"
```
to:
```json
"dev:server": "tsx watch --env-file=.env server/index.ts"
```

- [ ] **Step 4: Verify tsx forwards `--env-file`**

Create a throwaway `.env` if none exists (`printf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev\n' > .env`), then run:
```bash
npx tsx --env-file=.env -e "console.log('DATABASE_URL seen:', !!process.env.DATABASE_URL)"
```
Expected: `DATABASE_URL seen: true`. If tsx rejects `--env-file`, use the documented fallback in the spec — change the script to `node --env-file=.env --import tsx server/index.ts` — and re-verify. Remove the throwaway `.env` afterward if you created one (it is gitignored, so it will not be committed regardless).

- [ ] **Step 5: Commit**

```bash
git add .env.example .gitignore package.json
git commit -m "feat(db): load .env for dev server; document local/Neon DATABASE_URL"
```

---

## Task 4: Integration verification + docs

**Files:**
- Modify: `server/index.ts` (clearer boot-failure message)
- Modify: `CLAUDE.md`

- [ ] **Step 0: Improve the migration-failure message in `server/index.ts`**

The startup wraps `runMigrations()` and exits on failure. Make the message name
the likely local cause. Find the existing catch (added in Phase 1):
```ts
  .catch((err) => {
    console.error('Migration failed, server not started:', err)
    process.exit(1)
  })
```
Replace its `console.error` line with a hint:
```ts
  .catch((err) => {
    console.error(
      'Database unavailable — migrations failed, server not started.\n' +
      'Check that DATABASE_URL is set (see .env.example) and the database is running ' +
      '(`npm run db:up` for local Docker). Original error:',
      err,
    )
    process.exit(1)
  })
```
Run `npx tsc --noEmit` after the edit (expect pass). Keep the rest of the startup wrapper unchanged.

- [ ] **Step 1: (Operational, if Docker is available) End-to-end local flow**

This proves the whole chain: node-postgres driver → local Docker → migrate-on-boot → seed → query. With Docker available:
```bash
npm run db:reset          # fresh ephemeral DB
printf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev\n' > .env
# apply migrations + seed against the real local DB:
npm run db:seed
# confirm a round-trip against real Postgres:
npx tsx --env-file=.env -e "import('./server/repositories/bills-repository.ts').then(async ({ BillsRepository }) => { const r = await new BillsRepository().getAll(25); console.log('bills in local DB:', r.length); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })"
```
Expected: `db:seed` prints `Seeded: N bills, ...`; the round-trip prints `bills in local DB: N` (N matching the seed). This confirms the node-postgres path works against real Postgres end-to-end.

> If Docker is unavailable in this environment, record that this step is deferred to a developer machine. The build gates (test suite on pglite, tsc, lint) in Task 1 already cover the code; this step validates the runtime wiring against real Postgres.

- [ ] **Step 2: Update `CLAUDE.md` — add a "Local database" section**

Under the Commands or Architecture area (match the file's existing style), document the local dev DB workflow concisely:

```
### Local database

The server connects to whatever `DATABASE_URL` points at — a local Docker
Postgres (default) or Neon. One driver (`node-postgres`) serves both; switching
is a one-line `.env` edit. Tests use in-memory pglite and need no database.

Setup: copy `.env.example` → `.env`.

- `npm run db:up`     start local Postgres (Docker)
- `npm run db:down`   stop it
- `npm run db:reset`  wipe the volume and start fresh (ephemeral)
- `npm run db:seed`   load the JSON baseline as test data (preloaded)

Ephemeral run:  `npm run db:reset` → `npm run dev`  (empty DB, schema applied on boot).
Preloaded run:  `npm run db:up` → `npm run dev` → `npm run db:seed`  (test data, persists until reset).

To use Neon instead, set `DATABASE_URL` to the Neon pooled connection string
(`...-pooler.neon.tech/...?sslmode=require`) in `.env`.
```

Also remove/replace any now-stale Phase-1 note that named `@neondatabase/serverless` as the driver, if present (the driver is now `node-postgres`).

- [ ] **Step 3: Final gates**

Run: `npm test` → all pass (247).
Run: `npx tsc --noEmit` → pass.
Run: `npm run lint` → no NEW errors (a pre-existing error in `tests/components/ParliamentStrip.test.tsx` is unrelated).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts CLAUDE.md
git commit -m "feat(db): clearer boot-failure message + document local database workflow"
```

---

## Done — Summary

After these four tasks: the dev server runs against real Postgres selected only by
`DATABASE_URL`; local Docker runs ephemeral (`db:reset`) or preloaded (`db:seed`);
one `node-postgres` driver serves local Docker and Neon identically; tests remain
on pglite. This also resolves the Phase-1 deploy concern that the backend could
only talk to Neon — it now talks to any Postgres, and a developer can run the full
stack offline.
