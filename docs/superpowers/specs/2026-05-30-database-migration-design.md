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

1. **Features that need a DB** — accounts and a persistent translation cache
   cannot sit on JSON files.
2. **Operational confidence** — JSON-on-disk is fragile for production; we want
   durability, transactions, and concurrent-safe writes.

### Why Drizzle + Neon

- **Neon** has a genuine free tier for serverless Postgres. Render's disk is
  ephemeral, so SQLite would be wiped on every deploy — Neon sidesteps that.
- **Drizzle** offers a SQL-feel query builder with first-class TypeScript types
  generated from the schema, plus a migration tool (Drizzle Kit) that tracks
  applied migrations.

### Migration strategy: big-bang

All server JSON reads/writes are replaced with DB access in one pass. A one-time
seed script loads the existing JSON into the DB. The mutable JSON files remain
in the repo as the **seed baseline** and for the frontend's initial static
render, but are no longer written at runtime.

### Core data-model principle: entities vs. tracking

The central design decision. The current JSON conflates two different things:

- **Entities** — objective facts fetched from the Knesset (a bill's title and
  status, a committee's sessions, an MK's roles). These are **shared global
  data**: one copy, the same for everyone.
- **Tracking** — *which* entities are surfaced, plus per-tracker metadata like a
  bill's `position` (תומכים/מתנגדים/עוקבים) and `notes`. This is a
  **relationship**, not a property of the entity. In a future multi-user world
  (item 3) it is per-user.

The migration **separates these**: entity tables hold the shared pool; separate
tracking tables hold the relation. Today there is one implicit tenant, so the
tracking tables carry no `user_id` — adding it in item 3 is purely additive.

This split resolves the deletion model (see §5): entities are append/update-only
and never deleted here; only **tracking rows** (untracking) and **caches** (TTL)
are ever deleted. Garbage-collecting entities no user tracks is a separate
future feature, not part of this work.

---

## 1. DB Module Structure

```
server/db/
  client.ts          ← driver-selecting connection singleton, exports `db`
  migrate.ts         ← runs Drizzle migrations on server start
  schema/
    bills.ts         ← bills, tracked_bills
    committees.ts    ← committees, committee_sessions, tracked_committees
    mks.ts           ← mks, mk_knesset_terms, mk_roles, mk_activity, mk_votes, tracked_mks
    caches.ts        ← knesset_members_cache, knesset_committees_cache, summaries_cache
    annotations.ts   ← mk_annotations
    config.ts        ← knesset_config, feature_flags
  migrations/        ← Drizzle Kit-generated SQL + meta/_journal.json (committed to git)
```

- **Per-domain schema split** is a code-organization choice only. Drizzle Kit
  still generates a single sequential migration per `generate` run covering all
  tables, regardless of split.
- `client.ts` exposes one `db` instance. The driver is selected by environment
  (see §6): Neon's WebSocket Pool driver in dev/prod, `pglite` under test.
- `drizzle.config.ts` at the repo root points Drizzle Kit at `server/db/schema/`
  and reads `DATABASE_URL`.

### Driver choice (transactions)

Repository writes decompose an aggregate (e.g. `Mk`) into a parent row plus
child rows **inside one transaction**. This requires interactive transaction
support. The app is a **persistent Express server** (not edge/serverless
functions), so `client.ts` uses the **WebSocket Pool driver**
(`drizzle-orm/neon-serverless` with `Pool` from `@neondatabase/serverless`),
which supports `db.transaction()`. The HTTP driver (`neon-http`) is **not** used —
its interactive-transaction limitations would break the reassembly writes.

### Migrations are incremental and idempotent

Drizzle maintains a `__drizzle_migrations` table in the database. On each run,
`migrate()` reads `migrations/meta/_journal.json`, compares against the applied
set, and applies **only pending migrations** in order. Running `migrate()` on
every server startup is safe and cheap — a no-op (one `SELECT`) when nothing
changed.

Migration files (including `meta/_journal.json`) **must be committed to git** —
they are the authoritative record of applied schema changes. They are never
hand-edited; `drizzle-kit generate` produces them from schema changes. The first
migration is pure `CREATE TABLE` (instantaneous); later `ALTER TABLE` locks only
the specific table for milliseconds.

### No cascade deletes

**No foreign key uses `ON DELETE CASCADE`.** All FKs use `ON DELETE RESTRICT`.
Entities are never hard-deleted (see §5), so cascade would never fire anyway;
`RESTRICT` documents and enforces the "parents are never deleted out from under
their children" guarantee.

---

## 2. Schema — Entity Tables (shared global pool)

Objective Knesset facts only. No tracking metadata, no `tracked` flag. All shapes
round-trip to/from the interfaces in `src/types.ts`; the repositories derive a
few fields (noted below) so the API shapes consumers see are unchanged.

### `schema/bills.ts` → `bills`

```
bills
  id                serial PK
  oknesset_id       text
  number            text
  title             text
  status            text       -- 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה'
  committee         text
  source_url        text
  document_url      text null
  knesset_url       text null
  knesset_number    integer    -- the Knesset the bill was filed in (OData KNS_Bill.KnessetNum)
  has_new_data      boolean
  last_polled_at    timestamptz null
```

- `position` and `notes` move to `tracked_bills` (§3) — they are the tracker's
  stance, not bill facts.
- **Currency is derived**, not stored: a bill is current when
  `knesset_number = (SELECT current_knesset FROM knesset_config)`. The repository
  sets `Bill.inactive = knesset_number !== current_knesset` on read so the
  existing `Bill.inactive?: boolean` type field is preserved (no consumer reads
  it today, but the shape is kept consistent).

### `schema/committees.ts` → `committees`, `committee_sessions`

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

committee_sessions
  session_id          integer PK         -- CommitteeSession.sessionId
  committee_id        integer FK → committees.id (RESTRICT)
  date                timestamptz
  knesset_num         integer            -- sessions ARE Knesset-scoped
  title               text
  session_url         text
  attending_site_ids  text[]
  ai_summary          text null
```

- **Committees have no `knesset_number` and no currency flag.** Committees are
  standing bodies that persist across Knessets (ועדת הכספים exists in Knesset 24,
  25, 26…), so tagging a committee with a single Knesset would wrongly hide a
  still-live body. Committee *liveness* (open/closed/dissolved) is a different
  concept, sourced from the Knesset API, and is **out of scope here** — it is
  backlog item 5 (Closed Committees) and item 6 (Knesset Transition), neither of
  which is currently sourced. When item 5 is built, a `closed_at` / `active`
  column is added then.
- Sessions remain Knesset-scoped via `knesset_num` (already on
  `CommitteeSession`).

### `schema/mks.ts` → `mks`, `mk_knesset_terms`, `mk_roles`, `mk_activity`, `mk_votes`

```
mks
  id                serial PK
  oknesset_id       text
  knesset_site_id   text null
  name              text
  email             text null
  photo_url         text null
  voting_summary    text null
  source_url        text
  has_new_data      boolean
  last_polled_at    timestamptz null
  -- no `party` (→ mk_knesset_terms), no `inactive` (derived)

mk_knesset_terms                          -- membership + faction per Knesset
  id                serial PK
  mk_id             integer FK → mks.id (RESTRICT)
  knesset_number    integer
  faction           text                  -- party/faction served that Knesset
  unique(mk_id, knesset_number)           -- one faction per term; item 11 relaxes this

mk_roles
  id                serial PK
  mk_id             integer FK → mks.id (RESTRICT)
  position_id       integer
  description       text
  committee_name    text null
  is_current        boolean
  start_date        timestamptz null
  -- factionName dropped (was unused; faction now lives in mk_knesset_terms)

mk_activity
  id                serial PK
  mk_id             integer FK → mks.id (RESTRICT)
  type              text       -- 'bill_initiated' | 'vote' | 'duty_change' | 'question'
  date              timestamptz
  title             text
  detail            text null
  source_url        text null

mk_votes
  id                serial PK
  mk_id             integer FK → mks.id (RESTRICT)
  date              timestamptz
  bill_title        text
  vote              text       -- 'בעד' | 'נגד' | 'נמנע' | 'נעדר'
```

Derived on read (to preserve `src/types.ts` shapes):
- `Mk.party` = `faction` of the `mk_knesset_terms` row where
  `knesset_number = current_knesset`.
- `Mk.inactive` = the MK has **no** `mk_knesset_terms` row for `current_knesset`.
  `MkCard.tsx` reads `mk.inactive` (dimming + a badge), so the repository must
  keep populating it.

Party migration *between* Knessets is captured (one term row per Knesset).
Mid-term defection (multiple factions within one Knesset) is deferred — see
**backlog item 11**, which documents the forward-compatible upgrade path
(relax the unique constraint, add `start_date`/`end_date`).

---

## 3. Schema — Tracking Tables (the relation)

Per-type tables (not one polymorphic table) so FK integrity is real and bills
get their tracker-specific fields naturally. **No `user_id` yet** — one implicit
tenant today; item 3 adds `user_id` as an additive column.

```
tracked_bills
  id                serial PK
  bill_id           integer FK → bills.id (RESTRICT)
  position          text       -- 'תומכים' | 'מתנגדים' | 'עוקבים'
  notes             text
  created_at        timestamptz

tracked_committees
  id                serial PK
  committee_id      integer FK → committees.id (RESTRICT)
  created_at        timestamptz

tracked_mks
  id                serial PK
  mk_id             integer FK → mks.id (RESTRICT)
  created_at        timestamptz
```

- The tracked-X repositories join their table to the entity table and return
  fully-formed `Bill[]` / `Committee[]` / `Mk[]` — same API shapes as today.
  For bills, `position`/`notes` come from `tracked_bills`.
- `DELETE /api/tracking/:type/:id` deletes the **tracking row**, leaving the
  entity in the shared pool (see §5).

---

## 4. Schema — Cache, Annotation & Config Tables

### `schema/caches.ts`

API-response caches. The two list caches are replaced wholesale on refresh
(truncate + insert in one transaction), so every row shares the same
`cached_at`; TTL is read by querying any single row's `cached_at`.

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

### `schema/annotations.ts` → `mk_annotations`

```
mk_annotations
  knesset_site_id   text PK
  is_liberal        boolean
  is_supporter      boolean
```

### `schema/config.ts` → `knesset_config`, `feature_flags`

```
knesset_config                -- single row (id = 1)
  id                integer PK (always 1)
  current_knesset   integer
  detected_at       timestamptz

feature_flags                 -- one row per flag
  name              text PK    -- 'policyFilter' | 'trendingAlgorithm' | 'recentRanking'
  enabled           boolean    -- activation status
  value             text null  -- selected variant for mode flags; null for pure toggles
  description       text null  -- human note for a future admin UI
  updated_at        timestamptz
```

`feature_flags` is a row-per-flag table rather than a JSONB blob. It represents
both pure toggles (`policyFilter` → `enabled`) and mode flags
(`trendingAlgorithm` → `value = 'manual'`, `recentRanking` → `value = 'newest'`).
`FeatureFlagsRepository` reassembles the rows into the existing
`BillsFeatureFlags` object, so `server/routes/bills.ts` and
`src/hooks/useBillsOverview.ts` consume the same shape unchanged.

Current data maps to:
- `{ name: 'policyFilter',       enabled: true, value: null }`
- `{ name: 'trendingAlgorithm',  enabled: true, value: 'manual' }`
- `{ name: 'recentRanking',      enabled: true, value: 'newest' }`

---

## 5. Deletion Model

The only true deletions in the system are:

1. **Tracking rows** — `DELETE /api/tracking/:type/:id` removes the row from
   `tracked_bills` / `tracked_committees` / `tracked_mks`. The entity stays in
   the shared pool. Untracking is current curation state, not a historical fact,
   so there is nothing to preserve.
2. **Caches** — TTL expiry / wholesale replacement of the cache tables.

**Entities (`bills`, `committees`, `mks`, and their child rows) are never
hard-deleted** by routes or the poller. `ON DELETE RESTRICT` on every FK enforces
this. Child rows (sessions, roles, activity, votes) are refreshed on each poll by
replace-set (delete-then-insert within the parent's write transaction); this is a
derived-data refresh, not entity deletion, and the Knesset API returns the full
set each poll so nothing historical is lost.

**Deferred (separate future features):** garbage-collecting entities that no
tracker references, and pruning data for dead users — both belong to the
multi-user work (item 3), not this migration.

---

## 6. Repository Layer

Every table is accessed through a repository in `server/repositories/`. Routes
and the poller call repositories only — they never import `db` or schema
directly.

```
BillsRepository          ← bills entity pool (upsert from poller/search)
TrackedBillsRepository   ← tracked_bills ⋈ bills → Bill[] with position/notes
CommitteesRepository     ← committees + committee_sessions (owns the join)
TrackedCommitteesRepo    ← tracked_committees ⋈ committees → Committee[]
MksRepository            ← mks + mk_knesset_terms + mk_roles + mk_activity + mk_votes
TrackedMksRepository     ← tracked_mks ⋈ mks → Mk[] (derives party, inactive)
SummariesRepository      ← summaries_cache (replaces summaries-cache.json)
KnessetConfigRepository  ← knesset_config single row
FeatureFlagsRepository   ← feature_flags rows ↔ BillsFeatureFlags

MkListRepository         ← reworked file → knesset_members_cache (keeps getAgeMs/TTL)
CommitteeListRepository  ← reworked file → knesset_committees_cache
MkAnnotationsRepository  ← reworked file → mk_annotations
```

### Reassembly responsibility

Because `Committee` and `Mk` are normalized across multiple tables, the
repository owns the round-trip and returns exactly the shapes in `src/types.ts`:

- `MksRepository.getAll()` returns `Mk[]` with `currentRoles`, `activity`,
  `recentVotes` populated from child tables, and `party` + `inactive` derived
  from `mk_knesset_terms` against `current_knesset`.
- `CommitteesRepository.getAll()` returns `Committee[]` with `recentSessions`
  from `committee_sessions`.
- Writes decompose the aggregate into parent + child rows inside **one
  transaction** (delete-then-insert children to stay idempotent).

### `tracking.ts` cleanup

The inline `readItems` / `writeItems` helpers in `server/routes/tracking.ts` are
deleted. Handlers call the entity + tracked repositories instead. `POST`
adds/looks-up the entity in the pool and inserts a tracking row; `DELETE` removes
the tracking row. This resolves the bypass pattern flagged in the backlog.

### Knesset transition service

`server/services/knesset-config.ts` is rewritten. Its old behavior — flipping
`mk.inactive` flags, rewriting `mks.json`, and `unlink`ing cache files — is
replaced by:
- Bump `current_knesset` via `KnessetConfigRepository`. MK currency then derives
  automatically from `mk_knesset_terms` — no flag-flipping.
- Re-poll to stamp the new Knesset's members with `mk_knesset_terms` rows.
- "Clear the caches" becomes truncating `knesset_members_cache` /
  `knesset_committees_cache` via their repositories (instead of `unlink`).

---

## 7. Seed & Server Startup

### One-time seed script

```
scripts/seed-db.ts    ← reads every mutable src/data/*.json file and inserts
                        into the DB through the repositories.
                        Run with: npx tsx scripts/seed-db.ts
```

- Reuses the repositories' write methods, so decomposition logic lives in one
  place. Splits each `bills.json` row into a `bills` entity row + a
  `tracked_bills` row (position/notes); likewise for committees/mks.
- Seeds `bills.knesset_number` and each MK's `mk_knesset_terms` row with the
  current Knesset (`knesset_config.current_knesset`, = 25) since the existing
  JSON predates the field.
- Idempotent: truncates tables before insert, so re-running resets to the JSON
  baseline.

### Server startup sequence (`server/index.ts`)

```
1. Run Drizzle migrations (migrate.ts) — creates/updates tables (no-op if current)
2. Start Express, begin listening
3. Poller starts (unchanged)
```

### Environment config

- `DATABASE_URL` (Neon connection string) added to `.env` locally and to
  Render's environment variables.
- `drizzle.config.ts` reads `DATABASE_URL` and points at `server/db/schema/`.

### JSON files after migration

Mutable JSON files stay in the repo as the seed baseline and for the frontend's
initial static render (instant first paint before the API responds). They are no
longer written at runtime — the server reads/writes the DB exclusively.

---

## 8. Testing

### Driver selection

`db/client.ts` selects its driver from the environment:
- **Neon WebSocket Pool driver** when `DATABASE_URL` targets Neon (dev/prod).
- **`pglite`-backed Drizzle instance** when running under Vitest (detected via
  `NODE_ENV=test` or a `TEST_DATABASE` flag).

Repositories import `db` unchanged and are agnostic to the backing driver. This
seam is the only place that distinguishes test from production.

### Test database isolation

`pglite` runs **in-memory** (`new PGlite()` with no data directory):
- **Never touches Neon, never touches local disk.** No connection string and no
  file under `src/data/` or anywhere in the repo. The dev/prod database is
  completely unaffected by test runs.
- **Lives for the test session, not per-assertion.** The instance is created
  once per test file (`beforeAll`); `migrate()` builds a fresh schema into it;
  it persists across all tests in the file, so multi-step flows (write → read →
  update → re-read) run as a continuous DB session.
- **Discarded at teardown.** When the test process exits, the in-memory Postgres
  evaporates. Nothing is reflected anywhere persistent.
- **Optional fresh-per-test isolation:** a test needing a clean slate truncates
  tables in `beforeEach`; the default is one in-memory session per file.

### Coverage

- **Round-trip assertions** are the core coverage: write a known `Mk` /
  `Committee` / tracked `Bill`, read it back, assert deep equality against
  `src/types.ts` shapes — proving normalization/reassembly across join tables
  (entity ⋈ tracking, terms/roles/activity/votes) is lossless, and that derived
  fields (`Mk.party`, `Mk.inactive`, `Bill.inactive`) compute correctly against
  `current_knesset`.
- **Existing component tests** (`tests/components/`) are unaffected — they import
  static JSON and never touch the server DB.

`pglite` keeps the server test suite offline and fast, matching the current
"no servers needed" property.

---

## Suggested Implementation Phasing

This migration is large; the implementation plan should be phased rather than one
long sequence:

- **Phase 1 — foundation:** DB module (`client.ts` driver seam, `migrate.ts`),
  schema files, entity + cache + config repositories, seed script, pglite test
  harness, server-startup wiring. Entities readable/writable through repositories.
- **Phase 2 — tracking split & route rewrite:** tracking tables and repositories,
  `tracking.ts` rewrite (entity-pool + tracking-row semantics), and the
  `knesset-config.ts` transition-service rewrite.

---

## Out of Scope

- User accounts, auth, email alerts (item 3) — unblocked by this work, designed
  separately. `user_id` on tracking tables is the additive hook.
- Garbage-collecting entities no tracker references; pruning dead-user data —
  future multi-user work.
- Committee liveness (open/closed/dissolved) — items 5 and 6; not sourced yet.
- MK mid-term faction defections — backlog item 11 (forward-compatible).
- Migrating static content JSON to the DB — stays as imports.

## Dependencies Added

- `drizzle-orm`, `drizzle-kit`
- `@neondatabase/serverless` (provides `Pool` for the WebSocket driver)
- `@electric-sql/pglite` (dev/test only)

## Assumptions

- OData `KNS_Bill` reliably carries `KnessetNum` (verified: already used in the
  bills-overview service filters) — the source for `bills.knesset_number`.
- Existing `bills.json` / `mks.json` rows are seeded with the current Knesset
  (25), since they predate the Knesset-number fields.
- `Mk.party`, `Mk.inactive`, and `Bill.inactive` are derived on read; no stored
  columns back them. `MkCard.tsx` is the only consumer of `inactive` today.
