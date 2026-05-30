# Local Database Environment — Design

**Date:** 2026-05-30
**Status:** Approved
**Project:** `/home/aavitan/claude-projects/liberal-page`
**Relates to:** Database Migration (BACKLOG item 2) — Phase 1
(`docs/superpowers/specs/2026-05-30-database-migration-design.md`)

---

## Overview

After the Phase 1 database migration, the backend requires a real Postgres
connection to boot. The Phase 1 driver (`@neondatabase/serverless`) talks only to
Neon, so a developer cannot run the app locally without provisioning a cloud
database. This spec adds a **local database environment**: the dev server runs
against a real Postgres that is either a **local Docker** instance (default,
highest fidelity, offline) or a **Neon** instance — selected purely by config,
with the application code identical for both. The local Docker database can be
run **ephemeral** (fresh empty state) or **preloaded** (seeded with test data).

### Goals

1. Run the full app locally without provisioning Neon.
2. Two run states for the local database: **ephemeral** (clean each reset) and
   **preloaded** (seeded with the JSON baseline as test data).
3. Switching between local Docker and Neon is **config-only** — no code change,
   no per-target driver. As transparent as possible.
4. Tests remain on in-memory pglite — fast, hermetic, no Docker.

### Non-goals

- Running the test suite against Docker Postgres (tests stay on pglite; a
  real-Postgres fidelity job is a separate, optional future CI concern).
- Supporting two dev database *engines* simultaneously (pglite-for-dev was
  considered and rejected as confusing; dev uses real Postgres only).
- Any change to repositories, routes, schema, or the seed script.

---

## 1. Driver Consolidation

The design rests on collapsing the Postgres drivers to a single one selected only
by environment.

```
server/db/client.ts:
  NODE_ENV=test   → pglite in-memory                  (tests — unchanged)
  otherwise       → node-postgres Pool(DATABASE_URL)  (dev + prod)
```

- **Remove** `@neondatabase/serverless` and `drizzle-orm/neon-serverless`.
  **Add** `pg` and `drizzle-orm/node-postgres`.
- `server/db/migrate.ts` mirrors the selection: the pglite migrator under test,
  the node-postgres migrator otherwise.
- **Repositories do not change.** Drizzle's query API is identical across
  `drizzle-orm/node-postgres` and the previous driver; only `client.ts`,
  `migrate.ts`, and `package.json` are touched.

### Why `node-postgres` for both targets

`@neondatabase/serverless` tunnels the Postgres protocol over WebSocket/HTTP for
**edge/serverless** runtimes that cannot open raw TCP sockets. Our backend is a
**persistent Express server on Render**, which holds a normal TCP connection
pool — exactly what `node-postgres` is built for. Neon also accepts standard
`pg` connections through its pooled endpoint (`...-pooler.neon.tech`), so a
single `pg` driver reaches **both** local Docker Postgres and Neon. The
serverless driver cannot reach local Docker without an extra proxy. Therefore one
`pg` driver is both simpler and the correct choice for this deployment.

### Relationship to the open Phase 1 PR

Phase 1 (PR #2) shipped `neon-serverless`. This change supersedes that choice.
The `neon-serverless → pg` swap is the first implementation step here. It may be
applied to the Phase 1 PR before merge, or layered on top after — either is
clean, since only `client.ts`/`migrate.ts`/deps are involved and no repository
code depends on the driver.

---

## 2. Local Docker Postgres

A single-service `docker-compose.yml` at the repo root:

```yaml
services:
  db:
    image: postgres:17          # match Neon's major version
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: liberal_dev
    ports: ["5432:5432"]
    volumes: ["liberal_pgdata:/var/lib/postgresql/data"]
volumes:
  liberal_pgdata:
```

- **Image version** matches Neon's major (Postgres 17) for fidelity. The
  implementation plan verifies Neon's current default major and pins to match.
- The named volume `liberal_pgdata` is the hinge between ephemeral and preloaded
  modes.
- Default local connection string:
  `postgresql://postgres:postgres@localhost:5432/liberal_dev`.

---

## 3. Ephemeral vs Preloaded Modes

Migrations apply automatically on server boot (`runMigrations()` already does
this). The two modes differ only in volume state and whether the seed runs.

| Mode | State | Workflow |
|------|-------|----------|
| **Ephemeral** | Fresh empty DB; schema applied; no data | `npm run db:reset` → `npm run dev` |
| **Preloaded** | Fresh DB seeded with the JSON baseline; persists across restarts until reset | `npm run db:up` → `npm run dev` → `npm run db:seed` |

### npm scripts

```
db:up        docker compose up -d db
db:down      docker compose down
db:reset     docker compose down -v && docker compose up -d db   # wipe volume (ephemeral)
db:seed      tsx scripts/seed-db.ts                              # preload test data (exists)
```

- `db:seed` already exists and is idempotent (truncate-then-insert, from the
  Phase 1 review fix), so re-running it is safe.
- The dev server itself is unaware of the mode — it just connects to
  `DATABASE_URL` and runs migrations. Mode is determined entirely by whether the
  volume was wiped and whether `db:seed` was run.

---

## 4. Config and Transparency

**Single knob — `DATABASE_URL`.** A gitignored `.env` holds the active connection
string; `.env.example` ships both targets so switching is copy-paste:

```
# Local Docker (default for local dev)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev

# Neon (uncomment to point local dev at the cloud DB instead)
# DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.neon.tech/DBNAME?sslmode=require
```

The dev server loads `.env` via Node's built-in `--env-file` (no new dependency):

```
dev:server   tsx watch --env-file=.env server/index.ts
```

So selecting local Docker vs Neon is a one-line `.env` edit; nothing in code
changes. The implementation plan verifies that `tsx` forwards `--env-file`; the
documented fallback is `node --env-file=.env --import tsx server/index.ts`.

`.gitignore` must include `.env` (verify; add if absent). `drizzle.config.ts`
already reads `DATABASE_URL` for `db:generate`.

**SSL across both targets.** Local Docker Postgres connects without SSL; Neon
requires SSL. `node-postgres` honors `sslmode` from the connection string, so
the transparency holds as long as each URL carries the right parameter — the
local URL has none (plain), the Neon URL has `?sslmode=require`. The plan
verifies this against Neon (Neon may need `sslmode=require` without full cert
verification) and configures the `Pool` accordingly so a single client works for
both targets unchanged.

---

## 5. Boot Behavior and Testing

### Boot behavior

If the server starts while `DATABASE_URL` points at a Docker DB that is not
running, `runMigrations()` fails to connect and the process exits non-zero
(existing `process.exit(1)` path). The local workflow is "start the DB, then the
server." The plan improves the failure message to name the likely cause (database
not started / wrong `DATABASE_URL`) so the developer experience is clear.

### Testing — unchanged and isolated

`NODE_ENV=test` selects pglite in-memory exactly as today. Tests never read
`.env`, never touch Docker, and CI needs no database service. The existing
247-test suite stays fast and hermetic. The `db:reset`/`db:seed` scripts and the
Docker service are dev-only and are not exercised by `npm test`.

---

## Files Touched

**Modified:**
- `server/db/client.ts` — swap driver to node-postgres for the non-test path
- `server/db/migrate.ts` — node-postgres migrator for the non-test path
- `package.json` — remove neon deps, add `pg`/`drizzle-orm/node-postgres`; add
  `db:up`/`db:down`/`db:reset` scripts; add `--env-file=.env` to `dev:server`
- `.env.example` — local Docker + Neon connection strings
- `.gitignore` — ensure `.env` is ignored
- `CLAUDE.md` / docs — local dev DB section

**Created:**
- `docker-compose.yml` — single Postgres service with a named volume

**Untouched:** repositories, routes, schema, `scripts/seed-db.ts`, all tests.

## Dependencies

- **Add:** `pg`, `@types/pg` (dev), `drizzle-orm/node-postgres` (part of
  `drizzle-orm`, already installed)
- **Remove:** `@neondatabase/serverless`

## Assumptions

- The deployment target (Render) runs a persistent Node process, so `pg` over
  TCP is appropriate; Neon is reached via its pooled `pg`-compatible endpoint.
- Node version supports `--env-file` (Node ≥ 20.6; project runs Node 21.x).
- pglite remains the test driver; switching the dev/prod driver to `pg` does not
  affect the test path.
