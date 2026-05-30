# Database Migration — JSON → Drizzle + Neon Postgres — Design

**Date:** 2026-05-30
**Status:** Approved
**Project:** `/home/aavitan/claude-projects/liberal-page`
**Backlog item:** 2 (Database Migration)

---

## Overview

Replace the on-disk `src/data/*.json` datastore with a real PostgreSQL database,
accessed through [Drizzle ORM](https://orm.drizzle.team) and hosted on
[Neon](https://neon.tech) (serverless Postgres, free tier). This lays the
foundation for a production-grade application and unblocks two backlog items
that depend on a real database:

- Item 3 — User Accounts & Alerts
- Item 9 — Live Parliamentary Content Translation (long-term cache storage)

### Motivation

1. **Features that need a DB** (drivers C from brainstorming) — accounts and a
   persistent translation cache cannot sit on JSON files.
2. **Operational confidence** (driver D) — JSON-on-disk is fragile for
   production; we want proper durability, transactions, and concurrent-safe
   writes.

### Why Drizzle + Neon

- **Neon** has a genuine free tier for serverless Postgres (MySQL free tiers
  have largely disappeared). Render's own disk is ephemeral, so SQLite would be
  wiped on every deploy — Neon sidesteps that entirely.
- **Drizzle** offers a SQL-feel query builder — closer to writing SQL than a
  heavy ORM, with first-class TypeScript types generated from the schema and a
  migration tool (Drizzle Kit) that tracks applied migrations.

### Migration strategy: big-bang

All server JSON reads/writes are replaced with DB access in one pass. A one-time
seed script loads the existing JSON into the DB. The mutable JSON files remain
in the repo as the **seed baseline** and for the frontend's initial static
render, but are no longer written at runtime.

---

## 1. DB Module Structure

```
server/db/
  client.ts          ← driver-selecting connection singleton, exports `db`
  migrate.ts         ← runs Drizzle migrations on server start
  schema/
    bills.ts         ← bills table
    committees.ts    ← committees + committee_sessions
    mks.ts           ← mks + mk_roles + mk_activity + mk_votes
    caches.ts        ← knesset_members_cache, knesset_committees_cache, summaries_cache
    annotations.ts   ← mk_annotations
    config.ts        ← knesset_config, feature_flags
  migrations/        ← Drizzle Kit-generated SQL + meta/_journal.json (committed to git)
```

- **Per-domain schema split** is a code-organization choice only. Drizzle Kit
  still generates a single sequential migration per `generate` run covering all
  tables, regardless of how the schema is split across files.
- `client.ts` exposes one `db` instance. The driver is selected by environment
  (see §5): Neon's serverless driver in dev/prod, `pglite` under test.
- `drizzle.config.ts` at the repo root points Drizzle Kit at
  `server/db/schema/` and reads `DATABASE_URL`.

### Migrations are incremental and idempotent

Drizzle maintains a `__drizzle_migrations` table in the database. On each run,
`migrate()` reads `migrations/meta/_journal.json`, compares against the applied
set, and applies **only pending migrations** in order. Running `migrate()` on
every server startup is therefore safe and cheap — a no-op (one `SELECT`) when
nothing has changed.

Migration files (including `meta/_journal.json`) **must be committed to git** —
they are the authoritative record of applied schema changes. They are never
hand-edited; `drizzle-kit generate` produces them from schema changes.

Starting clean: the first migration is pure `CREATE TABLE`, which is
instantaneous. Future `ALTER TABLE` statements lock only the specific table for
milliseconds — Postgres never locks the whole database.

---

## 2. Schema

Nine mutable JSON files (those written by the server/poller) move to the DB.
Static content files (`about.json`, `faq.json`, `gallery.json`, `site.json`,
`primaries.json`, `protocols.json`, `representatives.json`, `updates.json`,
`trending-bills.json`, `committee-url-mapping.json`, `constitution.ts`) are read
by the frontend as imports, never written by the server, and stay as JSON.

Nested collections are modeled as **first-class child tables** (not JSONB):
committee sessions, MK roles, MK activity, MK votes. Simple string lists
(`attending_site_ids`, `attendees`) use Postgres native `text[]`.

All shapes round-trip to/from the interfaces in `src/types.ts` — callers see no
difference from the previous JSON shapes.

### `schema/bills.ts`

```
bills
  id                serial PK
  oknesset_id       text
  number            text
  title             text
  status            text       -- 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה'
  position          text       -- 'תומכים' | 'מתנגדים' | 'עוקבים'
  notes             text
  committee         text
  source_url        text
  document_url      text null
  knesset_url       text null
  has_new_data      boolean
  last_polled_at    timestamptz null
  inactive          boolean default false
```

### `schema/committees.ts`

```
committees
  id                          serial PK
  oknesset_id                 text
  name                        text
  chair                       text
  last_session_date           timestamptz null
  last_session_summary        text null
  last_session_document_url   text null
  source_url                  text
  has_new_data                boolean
  last_polled_at              timestamptz null
  inactive                    boolean default false

committee_sessions
  session_id          integer PK         -- CommitteeSession.sessionId
  committee_id        integer FK → committees.id (on delete cascade)
  date                timestamptz
  knesset_num         integer
  title               text
  session_url         text
  attending_site_ids  text[]
  ai_summary          text null
```

### `schema/mks.ts`

```
mks
  id                serial PK
  oknesset_id       text
  knesset_site_id   text null
  name              text
  party             text
  email             text null
  photo_url         text null
  voting_summary    text null
  source_url        text
  has_new_data      boolean
  last_polled_at    timestamptz null
  inactive          boolean default false

mk_roles
  id                serial PK
  mk_id             integer FK → mks.id (on delete cascade)
  position_id       integer
  description       text
  committee_name    text null
  faction_name      text null
  is_current        boolean
  start_date        timestamptz null

mk_activity
  id                serial PK
  mk_id             integer FK → mks.id (on delete cascade)
  type              text       -- 'bill_initiated' | 'vote' | 'duty_change' | 'question'
  date              timestamptz
  title             text
  detail            text null
  source_url        text null

mk_votes
  id                serial PK
  mk_id             integer FK → mks.id (on delete cascade)
  date              timestamptz
  bill_title        text
  vote              text       -- 'בעד' | 'נגד' | 'נמנע' | 'נעדר'
```

### `schema/caches.ts`

API-response caches. The two list caches are replaced wholesale on refresh
(truncate + insert in one transaction), so every row shares the same
`cached_at`. TTL is read by querying any single row's `cached_at`.

```
knesset_members_cache         -- one row per KnessetMember
  site_id           integer PK
  name              text
  party             text
  photo_url         text null
  is_liberal        boolean
  is_supporter      boolean
  cached_at         timestamptz

knesset_committees_cache      -- one row per CommitteeListItem
  committee_id      integer PK
  name              text
  knesset_url       text
  cached_at         timestamptz

summaries_cache               -- keyed by md5 (matches SummaryCache map key)
  md5               text PK
  summary           text
  created_at        timestamptz
  source_url        text
  attendees         text[] null
  derived_title     text null
```

### `schema/annotations.ts`

```
mk_annotations
  knesset_site_id   text PK
  is_liberal        boolean
  is_supporter      boolean
```

### `schema/config.ts`

Single-row config tables (enforced with a fixed `id = 1`).

```
knesset_config
  id                integer PK (always 1)
  current_knesset   integer
  detected_at       timestamptz

feature_flags
  id                integer PK (always 1)
  bills             jsonb      -- BillsFeatureFlags; small, opaque settings blob
```

> `feature_flags.bills` is the one intentional JSONB column — it is a small,
> read-mostly settings object with no query or join needs, and its shape
> (`BillsFeatureFlags`) is already a closed union in `src/types.ts`.

---

## 3. Repository Layer

Every mutable table is accessed through a repository class in
`server/repositories/`. Routes and the poller call repositories only — they
never import `db` or schema directly. This preserves the access boundary the
three existing repositories already establish.

```
BillsRepository          ← tracked bills (replaces tracking.ts inline helpers)
CommitteesRepository     ← committees + committee_sessions (owns the join)
MksRepository            ← mks + mk_roles + mk_activity + mk_votes (owns the joins)
SummariesRepository      ← summaries_cache (replaces summaries-cache.json)
KnessetConfigRepository  ← knesset_config single row
FeatureFlagsRepository   ← feature_flags single row

MkListRepository         ← reworked file → knesset_members_cache (keeps getAgeMs/TTL)
CommitteeListRepository  ← reworked file → knesset_committees_cache
MkAnnotationsRepository  ← reworked file → mk_annotations
```

### Reassembly responsibility

Because `Committee` and `Mk` are normalized across multiple tables, the
repository owns the round-trip:

- `CommitteesRepository.getAll()` returns fully-formed `Committee[]` with
  `recentSessions` populated from `committee_sessions`.
- `MksRepository.getAll()` returns `Mk[]` with `currentRoles`, `activity`, and
  `recentVotes` populated from their child tables.
- Writes decompose the object back into parent row + child rows inside **one
  transaction** (delete-then-insert children to keep the write idempotent).

Callers receive exactly the shapes defined in `src/types.ts`.

### `tracking.ts` cleanup

The inline `readItems` / `writeItems` helpers in `server/routes/tracking.ts` are
deleted. Route handlers call `BillsRepository`, `CommitteesRepository`, and
`MksRepository` instead. This resolves the bypass pattern flagged in the
backlog (routes that skipped the repository layer).

### Knesset transition service

`server/services/knesset-config.ts` performs file operations beyond config
writes: on a Knesset transition it rewrites `mks.json` (clearing/setting
`inactive` flags) and `unlink`s the two cache files to force a refresh. These
move to repository calls — `MksRepository` for the inactive-flag updates, and a
`truncate()`/`clear()` on `MkListRepository` and `CommitteeListRepository` in
place of `unlink`. The config write itself goes through `KnessetConfigRepository`.

---

## 4. Seed & Server Startup

### One-time seed script

```
scripts/seed-db.ts    ← reads every mutable src/data/*.json file and inserts
                        into the DB through the repositories.
                        Run with: npx tsx scripts/seed-db.ts
```

- Reuses the repositories' write methods, so decomposition logic (e.g.
  `Mk` → `mks` + `mk_roles` + `mk_activity` + `mk_votes`) lives in exactly one
  place rather than being duplicated.
- Idempotent: each table is truncated before insert, so re-running resets the DB
  to the JSON baseline safely.

### Server startup sequence (`server/index.ts`)

```
1. Run Drizzle migrations (migrate.ts) — creates/updates tables (no-op if current)
2. Start Express, begin listening
3. Poller starts (unchanged)
```

Migrations run automatically on every deploy. The seed script is run manually,
once (or whenever a reset to the JSON baseline is wanted).

### Environment config

- `DATABASE_URL` (Neon connection string) added to `.env` locally and to
  Render's environment variables.
- `drizzle.config.ts` reads `DATABASE_URL` and points at `server/db/schema/`.

### JSON files after migration

Mutable JSON files stay in the repo as the seed baseline and for the frontend's
initial static render (instant first paint before the API responds). They are no
longer written at runtime — the server reads/writes the DB exclusively.

---

## 5. Testing

### Driver selection

`db/client.ts` selects its driver from the environment:

- **Neon serverless driver** when `DATABASE_URL` targets Neon (dev/prod).
- **`pglite`-backed Drizzle instance** when running under Vitest (detected via
  `NODE_ENV=test` or a `TEST_DATABASE` flag).

Repositories import `db` unchanged and are agnostic to the backing driver. This
seam is the only place that distinguishes test from production.

### Test database isolation

`pglite` runs **in-memory** (`new PGlite()` with no data directory):

- **Never touches Neon, never touches local disk.** No connection string and no
  file under `src/data/` or anywhere in the repo. The dev/prod database is
  completely unaffected by test runs.
- **Lives for the test session, not per-assertion.** The in-memory instance is
  created once per test file (`beforeAll`); `migrate()` builds a fresh schema
  into it; that instance persists across all tests in the file. Data written in
  one step is visible to the next, so multi-step flows (write → read → update →
  re-read) run as a continuous DB session.
- **Discarded entirely at teardown.** When the test process exits, the in-memory
  Postgres evaporates. Nothing is reflected anywhere persistent.
- **Optional fresh-per-test isolation:** a test needing a clean slate truncates
  tables in `beforeEach`; the default is a single in-memory session per file.

### Coverage

- **Round-trip assertions** are the core coverage: seed a known `Mk` / `Committee`
  object, write it, read it back, assert deep equality against `src/types.ts`
  shapes. This proves normalization/reassembly across the join tables is
  lossless.
- **Existing component tests** (`tests/components/`) are unaffected — they import
  static JSON and never touch the server DB.

`pglite` keeps the server test suite offline and fast, matching the current
"no servers needed" property.

---

## Out of Scope

- User accounts, auth, and email alerts (backlog item 3) — unblocked by this
  work but designed separately.
- Translation cache storage (backlog item 9) — same.
- Migrating static content files to the DB — they remain JSON imports.
- Any change to the frontend data flow beyond the unchanged API contract.

## Dependencies Added

- `drizzle-orm`, `drizzle-kit`
- `@neondatabase/serverless`
- `@electric-sql/pglite` (dev/test only)
