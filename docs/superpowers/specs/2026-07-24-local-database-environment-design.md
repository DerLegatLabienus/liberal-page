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

Create one persistent Neon branch, e.g. named `local-dev`, via Neon's **schema-only branching**
(Beta): forks the parent's DDL/structure with **zero rows copied**. Created manually in the
Neon Console (Branches → Create branch → schema-only, parent = `production`) — the developer's
choice, since the Neon MCP tool available in this environment doesn't expose the schema-only
option and `neonctl` would need an interactive browser login unavailable here.

Schema-only branches are **independent roots** (no shared history with their parent), so
Neon's own `reset-from-parent` operation doesn't apply to this branch. That's not a gap:
`server/index.ts` already calls `runMigrations()` on every server boot, against whatever
`DATABASE_URL` resolves to — so the branch's schema self-updates to current exactly the same
way local Docker Postgres's would, with no Neon-side refresh step needed at all.

`.env.example`'s primary (uncommented) `DATABASE_URL` example becomes this branch's
connection string pattern; the developer's own `.env` (gitignored) holds the real one.

Seed with realistic-*shaped*, non-real data:
- `npm run db:seed` — the existing curated JSON baseline.
- `npm run db:import-mks` — pulls the **current** MK roster directly from the public Knesset
  OData API, not from prod's database, so the dataset is genuinely up to date without ever
  being a copy of a `production` row.

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
  two real local options: the schema-only `local-dev` Neon branch (default) and local Docker
  Postgres (offline alternative) — with an explicit, unambiguous statement that
  `DATABASE_URL` must **never** be the actual `production` branch's connection string for
  local development.
- **`.env.example`** — same reframing in the inline comments around `DATABASE_URL`.

### 4. Cleanup (deferred from earlier this session, now unblocked)

Once `.env` is repointed at the new `local-dev` branch, delete the synthetic rows that landed
in `production` during today's dev-login testing:
- `auth.users` — id 75 (`dev-admin@localhost`), id 76 (`dev-member@localhost`)
- `auth.allowed_emails` — the matching two rows
- `auth.refresh_tokens` — the two live tokens tied to those user ids

## Verification

- Confirm the new branch's schema matches `production`'s post-migration state: boot the app
  against it once, confirm `runMigrations()` reports the same migration set as applied (no
  errors, no unexpected pending migrations).
- Confirm zero rows exist on the branch before seeding (proves schema-only actually copied no
  data): `SELECT count(*) FROM auth.users` (and a couple of other tables) should be `0`.
- After seeding: `npm run dev` boots cleanly against the branch; spot-check a few pages
  (parliament tracker, letters) render with the seeded data.
- Confirm the local Docker alternative still works unchanged: `npm run db:reset` →
  `npm run dev` → `npm run db:seed`, same as documented today.
- After the cleanup step: re-query `production`'s `auth.users`/`allowed_emails`/
  `refresh_tokens` for the `dev-admin@localhost`/`dev-member@localhost` rows and confirm zero
  results.
