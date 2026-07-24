# Local database environment

**Date:** 2026-07-24
**Status:** Approved, pending implementation plan
**Scope:** Local dev environment configuration only. No app code changes, no schema changes.

## Problem

Local `.env`'s `DATABASE_URL` points directly at the Neon **`production`** branch — the only
branch that exists in this Neon project (confirmed via `describe_project`: one branch, named
`production`, `default: true`, `primary: true`). There is no isolation layer between local
development and real production data.

This already caused an incident: testing the local-dev sign-in bypass
(`ALLOW_DEV_LOGIN`, see `server/services/auth-providers/dev.ts`) ran the server with
`--env-file=.env`, which picked up the real `DATABASE_URL` and wrote real rows to production —
two synthetic users (`dev-admin@localhost` role=`admin`, `dev-member@localhost` role=`member`),
their `allowed_emails` entries, and two live (unexpired) refresh tokens. Nothing reachable in
practice (`ALLOW_DEV_LOGIN` is unset on the real Render deploy), but it should never have been
possible to write to production from a local run in the first place.

## Goals

- Local development must never read or write real production rows — no user emails, no
  refresh tokens, no real letter-recipient data, nothing copied from `production`.
- Local development's schema must always match what the migrations define, same as prod —
  no drift, no manual schema reconciliation step.
- Two selectable local targets, both satisfying the above, switchable via the one env var
  the app already reads for its DB target (`DATABASE_URL`) — no new config abstraction.

## Non-goals

- **No code-level guard** against accidentally pointing `DATABASE_URL` at production when
  `NODE_ENV` isn't `production` — considered and explicitly declined; this design relies on
  `.env`/`.env.example` being unambiguous instead.
- **No automated/scheduled schema or data refresh.** Unnecessary — see below.
- **Never copying real production row data** anywhere outside `production` itself, under any
  circumstance, even into a nominally "isolated" branch — a normal (data-copying) Neon branch
  was considered and rejected specifically because it would copy real user rows (including
  live refresh tokens) into a second environment, which is a real exposure, not a
  hypothetical one.

## Design

### 1. Neon schema-only branch — default local target

Create one persistent Neon branch named `dev`, via Neon's **schema-only branching** (Beta),
parent = `production`. Created manually in the Neon Console (Branches → Create branch →
schema-only) — the developer's choice, since the Neon MCP tool available in this environment
doesn't expose the schema-only option and `neonctl` would need an interactive browser login
unavailable here.

**Schema-only branching is used only for its data guarantee, not for its structure.** Neon's
schema-only clone copies zero rows at the storage level from the moment of creation — unlike
forking a normal branch and dropping tables afterward, which could still leave the data
transiently recoverable within Neon's point-in-time-recovery window. That guarantee is the
entire reason to use this branch type.

The structure it hands you is **not** what ends up running the app, though. Drizzle's migrator
(`drizzle-orm/node-postgres/migrator`, see `server/db/migrate.ts`) doesn't check "does this
table exist" — it checks its own tracking table (`drizzle.__drizzle_migrations`) to decide
which migration files still need to run. A schema-only clone would hand over tables that
already look fully migrated but an **empty** tracking table, so `runMigrations()` would try to
run migration `0001` from scratch against tables that already exist — a near-certain failure
on the very first `CREATE TABLE`.

So, immediately after creating the branch and before ever pointing the app at it, **drop
everything the clone gave us**:

```sql
DROP SCHEMA IF EXISTS public, parliament, auth, email, letters, analytics, config, drizzle CASCADE;
CREATE SCHEMA public;
```

(`drizzle` is Drizzle's own default migrations-journal schema; the other six are this
project's domain schemas per `server/db/schema/schemas.ts`.) This is a one-time step, run once
against the new branch, before it's ever used.

From that point on, `.env`'s `DATABASE_URL` points at this now-truly-empty branch, and
`server/index.ts`'s existing `runMigrations()` call — which already runs on every boot,
unconditionally — builds the **entire** schema by actually executing every migration file in
order, from `0001` onward, against a blank database. This is the exact same code path already
used for a fresh local Docker Postgres (`npm run db:reset` → empty volume → `runMigrations()`)
and for the pglite test snapshot — no special-casing, no clone/tracking-table mismatch to
reconcile by hand, no ambiguity about whether the resulting schema is "really" identical to
what migrations would produce, because it *is* what migrations produce.

Then seed with realistic-*shaped*, non-real data, same as any fresh database:
- `npm run db:seed` — the existing curated JSON baseline.
- `npm run db:import-mks` — pulls the **current** MK roster directly from the public Knesset
  OData API, not from prod's database, so the dataset is genuinely up to date without ever
  being a copy of a `production` row.

No Neon-side refresh mechanism (`reset-from-parent` doesn't apply to schema-only branches
anyway, since they're independent roots) is needed to keep the schema current later, either:
the next time a new migration file is added and merged, the same `runMigrations()` call picks
it up on the next boot, exactly like it would for local Docker Postgres.

### 2. Local Docker Postgres — opt-in alternative

No changes. `docker-compose.yml`'s `db` service, `npm run db:up`/`db:down`/`db:reset`, and
`npm run db:seed` already provide this fully, per the existing "Local database" section of
`CLAUDE.md`. Switching to it is exactly what it is today: point `.env`'s `DATABASE_URL` at the
local connection string instead of the Neon one.

Why keep both rather than pick one: the developer wants Neon-hosted as the everyday default
(reasons of their own — not needing Docker running locally, or wanting the DB reachable
without local compute) while keeping the fully-offline Docker path available as a fallback
(e.g. no network, or wanting zero Neon dependency for a stretch of work). Functionally the two
are equivalent for this app — same Postgres version (17 either way), same driver
(`node-postgres`), same migrations — so there's no behavioral reason to prefer one, only
availability/preference ones, which is exactly what an opt-in switch is for.

### 3. Documentation updates

- **`CLAUDE.md`** — "Local database" section currently reads "Neon (uncomment to point local
  dev at the cloud DB instead)," which today literally means *production*. Rewrite to present
  two real local options: the schema-only `dev` Neon branch (default) and local Docker
  Postgres (offline alternative) — with an explicit, unambiguous statement that
  `DATABASE_URL` must **never** be the actual `production` branch's connection string for
  local development.
- **`.env.example`** — same reframing in the inline comments around `DATABASE_URL`.

### 4. Cleanup (deferred from earlier this session, now unblocked)

Once `.env` is repointed at the new `dev` branch, delete the synthetic rows that landed
in `production` during today's dev-login testing:
- `auth.users` — id 75 (`dev-admin@localhost`), id 76 (`dev-member@localhost`)
- `auth.allowed_emails` — the matching two rows
- `auth.refresh_tokens` — the two live tokens tied to those user ids

## Verification

- Right after creating the branch, before the drop step: spot-check that the clone did copy
  structure but zero rows (e.g. `SELECT count(*) FROM auth.users` on the freshly-created
  branch, before dropping anything, should be `0` even though the table exists) — confirms the
  schema-only guarantee actually holds, rather than assuming it.
- After the `DROP SCHEMA ... CASCADE` step: confirm nothing is left —
  `SELECT schema_name FROM information_schema.schemata` should show only Postgres's own
  built-ins plus the fresh empty `public`.
- First boot against the branch: `runMigrations()` should run **every** migration file from
  `0001` onward (not "no pending migrations" — actually executing all of them), with no errors,
  and land on the same final schema shape as `production` (compare
  `information_schema.schemata`/`tables` between the two afterward).
- After seeding: `npm run dev` boots cleanly against the branch; spot-check a few pages
  (parliament tracker, letters) render with the seeded data.
- Confirm the local Docker alternative still works unchanged: `npm run db:reset` →
  `npm run dev` → `npm run db:seed`, same as documented today.
- After the cleanup step: re-query `production`'s `auth.users`/`allowed_emails`/
  `refresh_tokens` for the `dev-admin@localhost`/`dev-member@localhost` rows and confirm zero
  results.
