# Local Database Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local `.env`'s direct connection to the Neon `production` branch with a real
local-dev database: a schema-only Neon branch named `dev` whose schema is built by actually
running every migration file (not by trusting the clone's structure), seeded with non-real
data — plus documentation so this doesn't regress, and cleanup of the synthetic rows an
earlier local test run wrote to `production`.

**Architecture:** No application code changes. This is: one Neon branch operation (human,
via Console), a handful of SQL statements against that branch (via the Neon MCP `run_sql`
tool, targeted by `branchId` so `production` is never touched), one local `.env` edit, two
tracked-file doc edits (`.env.example`, `CLAUDE.md`), and one cleanup DELETE against
`production` (via Neon MCP `run_sql`, no `branchId` = default branch = `production`).

**Tech Stack:** Neon (Postgres 17, schema-only branching), Drizzle ORM migrator
(`drizzle-orm/node-postgres/migrator`), existing npm scripts (`db:seed`, `db:import-mks`,
`db:up`/`db:down`/`db:reset`), Neon MCP tools (`describe_project`, `get_connection_string`,
`run_sql`).

## Global Constraints

- **No app code changes, no schema changes** — this plan touches config/docs/data only (per
  spec `docs/superpowers/specs/2026-07-24-local-database-environment-design.md`, "Scope").
- **Never write real production row data into any other environment** — the entire reason
  this plan exists. Every step that touches `production` in this plan is either read-only
  (verification queries) or the explicit, scoped cleanup DELETE in Task 8 — nothing else.
- **The Neon project is `empty-hill-56029538`** (name "Liberal-page"); its only branch today
  is `production` (`br-calm-firefly-albhnewg`, default, primary). The new branch created in
  Task 1 must be named exactly `dev`.
- **`.env` is gitignored** — editing it is a local-machine change, never a commit.
  `.env.example` and `CLAUDE.md` are tracked — those edits do get committed.
- Every `mcp__neon__run_sql` call in Tasks 2–3 must pass `branchId` for the `dev` branch
  obtained in Task 1 — never omit it (omitting `branchId` targets the default branch, i.e.
  `production`).

---

### Task 1: Confirm the `dev` branch exists and fetch its connection details

**Files:** none (Neon-side operation + MCP calls only)

**Interfaces:**
- Produces: `devBranchId` (Neon branch ID string, e.g. `br-...`) and `devConnectionString`
  (a full `postgresql://...` URL) — every later task that touches the `dev` branch consumes
  one or both of these.

- [ ] **Step 1: Ask the user to confirm branch creation**

Before doing anything else, confirm with the user: *"Have you created the schema-only branch
in the Neon Console yet? Branches → Create branch → type: schema-only → parent: `production`
→ name: `dev`."* Do not proceed past this step until they confirm it exists — this is a
human-only action; there is no MCP/CLI path available to create it automatically (the Neon
MCP `create_branch` tool doesn't expose a schema-only option, and `neonctl` needs an
interactive browser login unavailable in this environment).

- [ ] **Step 2: List branches to confirm `dev` exists**

Call `mcp__neon__describe_project` with `projectId: "empty-hill-56029538"`. Confirm the
response's branch list now includes a branch named `dev` (in addition to `production`). Note
its `id` field as `devBranchId`.

Expected: a branch object with `"name": "dev"` present. If it's missing, stop and go back to
Step 1 — do not guess or proceed with `production`'s ID.

- [ ] **Step 3: Fetch the dev branch's connection string**

Call `mcp__neon__get_connection_string` with `projectId: "empty-hill-56029538"` and
`branchId: "dev"` (the tool accepts a branch name here, not just an ID). Save the returned
connection string as `devConnectionString` — it's needed verbatim in Task 4.

Expected: a `postgresql://...` URL whose host differs from `production`'s
(`...ep-twilight-salad-al8jrv7f-pooler...`) — confirms it's genuinely a different branch, not
an alias.

---

### Task 2: Verify the schema-only clone copied zero rows

**Files:** none (Neon MCP calls only)

**Interfaces:**
- Consumes: `devBranchId` from Task 1.
- Produces: confirmation that the schema-only guarantee held (gate before Task 3's drop —
  don't skip this, it's the one chance to observe the clone's row state before destroying it).

- [ ] **Step 1: Query row counts on tables that definitely have real data on `production`**

Call `mcp__neon__run_sql` three times, each with `projectId: "empty-hill-56029538"`,
`branchId: devBranchId`:

```sql
SELECT count(*) FROM auth.users;
```
```sql
SELECT count(*) FROM auth.refresh_tokens;
```
```sql
SELECT count(*) FROM letters.letter_contacts;
```

Expected: **all three return `0`**, even though `production`'s equivalents are non-empty
(confirmed earlier this session: `auth.users` has 3 rows, `letters.letter_contacts` has many).
If any of these returns non-zero, **stop immediately** — the schema-only clone did not behave
as documented, and Task 3's drop must not proceed until this is understood (report to the
user rather than continuing).

---

### Task 3: Drop everything the clone gave us

**Files:** none (Neon MCP calls only)

**Interfaces:**
- Consumes: `devBranchId` from Task 1; gated on Task 2 passing.
- Produces: a genuinely empty `dev` branch (only Postgres's own built-in schemas + a fresh
  empty `public`) — Task 4 depends on this being truly empty.

- [ ] **Step 1: Drop every schema the clone created**

Call `mcp__neon__run_sql` with `projectId: "empty-hill-56029538"`, `branchId: devBranchId`:

```sql
DROP SCHEMA IF EXISTS public, parliament, auth, email, letters, analytics, config, drizzle CASCADE;
CREATE SCHEMA public;
```

(`drizzle` is Drizzle's own migrations-journal schema; the other six are this project's
domain schemas per `server/db/schema/schemas.ts`.)

- [ ] **Step 2: Verify nothing is left**

Call `mcp__neon__run_sql` with the same `branchId`:

```sql
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema';
```

Expected: only `public` in the result — no `parliament`/`auth`/`email`/`letters`/`analytics`/
`config`/`drizzle`.

---

### Task 4: Point local `.env` at the `dev` branch and run migrations from scratch

**Files:**
- Modify: `/home/aavitan/claude-projects/liberal-page/.env` (gitignored, local-machine only —
  do not commit)

**Interfaces:**
- Consumes: `devConnectionString` and `devBranchId` from Task 1; gated on Task 3's
  empty-branch verification.
- Produces: a `dev` branch with the full current schema, built by the migrator — Task 5 and
  Task 9 both depend on this.

- [ ] **Step 1: Update `DATABASE_URL` in `.env`**

Open `/home/aavitan/claude-projects/liberal-page/.env` and replace the existing
`DATABASE_URL=...` line with:

```
DATABASE_URL=<devConnectionString from Task 1>
```

Tell the user this file has been changed (it's gitignored, so this doesn't show up in `git
status`, and it's easy to forget it happened).

- [ ] **Step 2: Boot the server once, against the empty branch, to run every migration**

```bash
cd /home/aavitan/claude-projects/liberal-page
./node_modules/.bin/tsx --env-file=.env server/index.ts > /tmp/dev-branch-boot.log 2>&1 &
```

Both `npx tsx <script>` **and** bare `./node_modules/.bin/tsx <script>` fork a grandchild
process (`node --require tsx/dist/preflight.cjs ... server/index.ts`) that a plain `kill` on
the `$!` PID does **not** stop — confirmed twice this session testing the dev-login feature,
where `kill $SERVER_PID` left the real process bound to the port. Don't trust `$!` alone here.

- [ ] **Step 3: Confirm it booted clean, then kill every matching process by pattern, not by PID**

```bash
sleep 4
cat /tmp/dev-branch-boot.log
```

Expected: no errors, ending in `Server running on http://localhost:3001`. There should be no
"relation already exists" or "no such table" errors — a blank database, then every migration
file `0001` onward applying cleanly, is exactly what a fresh local Docker Postgres already
does on its first boot, so this should look identical to that.

```bash
pkill -9 -f "server/index.ts"
sleep 1
ps aux | grep "server/index.ts" | grep -v grep
```

Expected: the `ps` line prints nothing (besides the `grep` invocation itself, which the second
`grep -v grep` already filters out) — confirms no process is still bound to port 3001 before
moving on.

- [ ] **Step 4: Verify the resulting schema matches `production`'s**

Compare schema structure between the two branches. Call `mcp__neon__run_sql` twice with
`projectId: "empty-hill-56029538"` — once with `branchId: devBranchId`, once with no
`branchId` (defaults to `production`) — both times:

```sql
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_schema IN ('parliament','auth','email','letters','analytics','config')
ORDER BY table_schema, table_name;
```

Expected: **identical table lists** between the two calls — proves the migrator produced the
same schema shape as `production`, just via actually running the migrations rather than
trusting the (now-deleted) clone.

---

### Task 5: Seed the `dev` branch with non-real data

**Files:** none (runs existing scripts against the `.env` set in Task 4)

**Interfaces:**
- Consumes: the migrated `dev` branch from Task 4 (via the `.env` already pointing at it) and
  `devBranchId` from Task 1 (for Step 3's verification query).
- Produces: a `dev` branch with realistic-shaped data for local development — Task 9's
  end-to-end check depends on this.

- [ ] **Step 1: Load the curated JSON baseline**

```bash
cd /home/aavitan/claude-projects/liberal-page
npm run db:seed
```

Expected: exits 0, console output describing rows inserted (bills/committees/MKs/feature
flags/etc. from the curated baseline).

- [ ] **Step 2: Import the current MK roster**

```bash
npm run db:import-mks
```

Expected: exits 0. This hits the public Knesset OData API directly (not `production`'s
database), so the ~132 MK contact rows it creates are genuinely current data, never a copy of
a `production` row.

- [ ] **Step 3: Verify data landed**

Call `mcp__neon__run_sql` with `projectId: "empty-hill-56029538"`, `branchId: devBranchId`:

```sql
SELECT
  (SELECT count(*) FROM parliament.mks) AS mks,
  (SELECT count(*) FROM letters.letter_contacts) AS letter_contacts,
  (SELECT count(*) FROM config.feature_flags) AS feature_flags;
```

Expected: all three counts `> 0`.

---

### Task 6: Update `.env.example`

**Files:**
- Modify: `/home/aavitan/claude-projects/liberal-page/.env.example`

**Interfaces:** none (documentation only)

- [ ] **Step 1: Replace the `DATABASE_URL` intro block**

Find this block near the top of the file:

```
# Local database connection. Copy this file to `.env` and pick ONE target.

# Local Docker Postgres (default — run `npm run db:up` first)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev

# Neon (uncomment to point local dev at the cloud DB instead)
# DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.neon.tech/DBNAME?sslmode=require
```

Replace it with:

```
# Local database connection. Copy this file to `.env` and pick ONE target.
#
# NEVER point this at the Neon "production" branch for local development — that's the live
# site's real database. Two safe local targets instead:

# Neon "dev" branch (default) — a schema-only branch (zero real rows, ever) forked from
# production, then its schema rebuilt from scratch by running every migration file (not by
# trusting the clone's structure) and seeded via `npm run db:seed` + `npm run db:import-mks`.
# See docs/superpowers/specs/2026-07-24-local-database-environment-design.md for how it was
# set up. Ask in the Neon console for this branch's connection string.
DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.neon.tech/DBNAME?sslmode=require

# Local Docker Postgres (fully offline alternative — run `npm run db:up` first)
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev
```

- [ ] **Step 2: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add .env.example
git commit -m "docs: point .env.example at the dev branch by default, not production

Local dev's DATABASE_URL previously suggested Neon's cloud DB with no
branch distinction -- which in practice meant production, the only
branch that existed. Now documents the schema-only dev branch as the
default and is explicit that production must never be used locally.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018n41h165AmVHBvJiWRu3D8"
git push
```

---

### Task 7: Update `CLAUDE.md`'s "Local database" section

**Files:**
- Modify: `/home/aavitan/claude-projects/liberal-page/CLAUDE.md`

**Interfaces:** none (documentation only)

- [ ] **Step 1: Replace the "Local database" section**

Find the section starting `### Local database` (currently reads, in full):

```
### Local database

The server connects to whatever `DATABASE_URL` points at — a local Docker
Postgres (default) or Neon. One driver (`node-postgres`) serves both; switching
is a one-line `.env` edit. Tests use in-memory pglite and need no database.

Setup: copy `.env.example` → `.env`.

- `npm run db:up`     start local Postgres (Docker)
- `npm run db:down`   stop it
- `npm run db:reset`  wipe the volume and start fresh (ephemeral)
- `npm run db:seed`   load the JSON baseline as test data (preloaded; pass DATABASE_URL or set it in your shell)

Ephemeral run:  `npm run db:reset` -> `npm run dev`  (empty DB, schema applied on boot).
Preloaded run:  `npm run db:up` -> `npm run dev` -> `npm run db:seed`  (test data, persists until reset).

To use Neon instead, set `DATABASE_URL` to the Neon pooled connection string
(`...-pooler.neon.tech/...?sslmode=require`) in `.env`.
```

Replace with:

```
### Local database

The server connects to whatever `DATABASE_URL` points at. **Never the Neon `production`
branch** — that's the live site's real database, with real user emails and live session
tokens; there is no code-level guard against pointing local dev at it, so this is enforced by
convention only (see the incident note in
`docs/superpowers/specs/2026-07-24-local-database-environment-design.md` if you want the full
story of why this line exists). Two safe local targets, switching is a one-line `.env` edit
either way. Tests use in-memory pglite and need no database at all.

**Default — Neon `dev` branch.** A schema-only branch (Beta) forked from `production`: zero
real rows copied, ever, at the storage level. Its schema was then rebuilt from scratch by
actually running every migration file (`runMigrations()`, same code path as a fresh local
Postgres) rather than trusting the clone's structure — Drizzle's migrator tracks which
migrations have run in its own journal table, and a structural clone alone would desync from
that. Ask in the Neon console for this branch's connection string; put it in `.env`.

**Alternative — local Docker Postgres**, fully offline, zero Neon dependency:

- `npm run db:up`     start local Postgres (Docker)
- `npm run db:down`   stop it
- `npm run db:reset`  wipe the volume and start fresh (ephemeral)
- `npm run db:seed`   load the JSON baseline as test data (preloaded; pass DATABASE_URL or set it in your shell)

Ephemeral run:  `npm run db:reset` -> `npm run dev`  (empty DB, schema applied on boot).
Preloaded run:  `npm run db:up` -> `npm run dev` -> `npm run db:seed`  (test data, persists until reset).

Setup either way: copy `.env.example` → `.env`, then set `DATABASE_URL` to whichever target.
```

- [ ] **Step 2: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add CLAUDE.md
git commit -m "docs: document the dev branch as the real local-database default

Local database section previously presented Neon as an undifferentiated
alternative to local Docker -- which in practice meant the production
branch, since it was the only one that existed. Now describes the
schema-only dev branch explicitly and states production must never be
used for local dev.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018n41h165AmVHBvJiWRu3D8"
git push
```

---

### Task 8: Clean up the synthetic dev-admin/dev-member rows from `production`

**Files:** none (Neon MCP calls only, against `production` — the one intentional exception to
"never touch production" in this plan, explicitly scoped to rows this session's earlier
testing created)

**Interfaces:** none

- [ ] **Step 1: Confirm the rows still match what was found earlier this session**

Call `mcp__neon__run_sql` with `projectId: "empty-hill-56029538"` (no `branchId` — this
targets `production`, deliberately):

```sql
SELECT id, email, role FROM auth.users WHERE email IN ('dev-admin@localhost', 'dev-member@localhost');
```

Expected: two rows, `dev-admin@localhost` (role `admin`) and `dev-member@localhost` (role
`member`), ids `75` and `76`. If the ids differ from `75`/`76` or the rows are already gone,
stop and re-derive the correct ids from this query's actual output before continuing — don't
assume `75`/`76` are still accurate.

- [ ] **Step 2: Delete the refresh tokens, then the users, then the allowlist entries**

Call `mcp__neon__run_sql` three times, each with `projectId: "empty-hill-56029538"` (no
`branchId`), in this order (refresh tokens reference `user_id`, so they must go first or the
foreign key will block the `users` delete):

```sql
DELETE FROM auth.refresh_tokens WHERE user_id IN (
  SELECT id FROM auth.users WHERE email IN ('dev-admin@localhost', 'dev-member@localhost')
);
```
```sql
DELETE FROM auth.users WHERE email IN ('dev-admin@localhost', 'dev-member@localhost');
```
```sql
DELETE FROM auth.allowed_emails WHERE email IN ('dev-admin@localhost', 'dev-member@localhost');
```

- [ ] **Step 3: Verify nothing is left**

Call `mcp__neon__run_sql` with `projectId: "empty-hill-56029538"` (no `branchId`):

```sql
SELECT
  (SELECT count(*) FROM auth.users WHERE email IN ('dev-admin@localhost', 'dev-member@localhost')) AS users,
  (SELECT count(*) FROM auth.allowed_emails WHERE email IN ('dev-admin@localhost', 'dev-member@localhost')) AS allowed_emails;
```

Expected: both `0`.

---

### Task 9: Full end-to-end verification

**Files:** none

**Interfaces:**
- Consumes: everything from Tasks 4–7.

- [ ] **Step 1: Confirm the app runs normally against the `dev` branch**

```bash
cd /home/aavitan/claude-projects/liberal-page
npm run dev
```

Open `http://localhost:5173/liberal-page/` (or use `npm run smoke:browser` per
`.claude/skills` conventions in this repo). Expected: page loads, Hebrew/RTL by default, the
Knesset tracker section renders with the seeded MK/bill data from Task 5. Stop the dev
servers when done (`Ctrl-C`, or the same careful-kill approach as Task 4 if backgrounded).

- [ ] **Step 2: Confirm the local Docker alternative still works, untouched by any of this**

```bash
cd /home/aavitan/claude-projects/liberal-page
npm run db:reset
```

Then, in `.env`, temporarily set `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/liberal_dev`
(or note it without overwriting the `dev` branch value if you want to preserve that — this
step is about proving the documented alternative still works, not about ending the plan in
this state).

```bash
npm run dev
```

Expected: boots cleanly against the empty local Postgres exactly as `CLAUDE.md`'s "Ephemeral
run" describes — same as before this plan started, confirming nothing about the Docker path
regressed.

```bash
npm run db:seed
```

Expected: exits 0. Then restore `.env`'s `DATABASE_URL` to the `dev` branch connection string
from Task 1, so the repo is left in its new intended default state.

- [ ] **Step 3: Final check — nothing was committed that shouldn't be**

```bash
cd /home/aavitan/claude-projects/liberal-page
git status --short
```

Expected: clean (or only showing files unrelated to this plan) — `.env` never appears here
since it's gitignored; `.env.example` and `CLAUDE.md` were already committed in Tasks 6–7.
