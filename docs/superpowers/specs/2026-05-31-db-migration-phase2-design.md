# Database Migration — Phase 2 (JSON → DB Cutover) — Design

**Date:** 2026-05-31
**Status:** Approved
**Project:** `/home/aavitan/claude-projects/liberal-page`
**Backlog item:** 2 (Database Migration) — Phase 2
**Builds on:** Phase 1
(`docs/superpowers/specs/2026-05-30-database-migration-design.md`)

---

## Overview

Phase 1 created the Postgres schema, repositories, migrations, and seed, but only
the **caches and annotations** were wired into the live code. The entire request
and poll path still reads and writes the JSON files, so the `bills`/`committees`/
`mks` DB tables are a dormant copy that only the seed touches — adds land in JSON,
never the database.

Phase 2 is the **cutover**: make Postgres the actual source of truth everywhere
(routes, poller, transition service, config, feature flags), move the frontend to
load only from the API, and delete the now-dormant runtime JSON. After Phase 2 the
JSON datastore is gone.

### Half-wired consumers replaced in this phase

| File | Today | After Phase 2 |
|------|-------|---------------|
| `server/routes/parliament.ts` | reads `*.json` | tracked repos (shared user) |
| `server/routes/tracking.ts` | read/write `*.json` | entity + tracked repos |
| `server/routes/bills.ts` | read/write `bills.json` | entity + tracked repos |
| `server/routes/committees.ts` | read/write `committees.json` | entity + tracked repos |
| `server/services/poller.ts` | read/write `*.json` | entity repos |
| `server/services/knesset-config.ts` | write `mks.json`/`knesset-config.json`, unlink caches | `KnessetConfig`/`Mks`/cache repos |
| `server/services/knesset-bills.ts` | read `feature-flags.json` | `FeatureFlagsRepository` |
| `src/hooks/useParliament.ts` | imports `*.json` | API only |
| `src/hooks/useBillsOverview.ts` | imports `feature-flags.json` | `GET /api/feature-flags` |
| `src/components/parliament/CommitteeCard.tsx` | imports `mks.json` | prop from state |

---

## Core model: shared entities, per-user tracking

The central decision (corrected during brainstorming):

- **Entities are a shared pool, aggregated across all users.** `bills`/
  `committees`/`mks` are first-class, one copy, not per-user. The poller enriches
  the shared pool once for everyone.
- **Tracking is per-user.** Each user has their own tracked set; what a user sees
  is *their* tracking ⋈ the shared entities. Per-tracker metadata (`position`/
  `notes` on bills) lives on the tracking row, not the entity.
- **Untrack removes only the tracking row; the entity persists** (referential
  preservation, consistent with Phase 1's no-cascade / RESTRICT model).
- **A user dimension exists now**, but with a **single shared account** that
  everybody uses, until real multi-user/auth lands. Tracking carries `user_id`
  from day one, so real accounts are purely additive — no re-migration.
- **Real foreign keys throughout.** The FK-less generic `(entity_type, entity_id)`
  tracking table was considered and rejected: that pattern suits large
  multi-service systems where cross-service FKs are a deployment burden, not this
  scale. Here it would discard integrity for genericity that nothing downstream
  uses (entity reassembly and rendering are inherently per-type).

---

## 1. Schema Additions

The Phase 1 entity, cache, config, and `feature_flags` tables are unchanged. Phase
2 adds a minimal `users` table and three per-type tracking tables.

```
users                              -- minimal now; grows with real auth later
  id            serial PK
  label         text               -- e.g. 'shared' (the single everybody-account)
  created_at    timestamptz
  -- seeded with exactly one row: the shared account

tracked_bills
  id            serial PK
  user_id       integer FK → users.id (RESTRICT)
  bill_id       integer FK → bills.id (RESTRICT)
  position      text               -- 'תומכים' | 'מתנגדים' | 'עוקבים'
  notes         text
  created_at    timestamptz
  unique(user_id, bill_id)

tracked_committees
  id            serial PK
  user_id       integer FK → users.id (RESTRICT)
  committee_id  integer FK → committees.id (RESTRICT)
  created_at    timestamptz
  unique(user_id, committee_id)

tracked_mks
  id            serial PK
  user_id       integer FK → users.id (RESTRICT)
  mk_id         integer FK → mks.id (RESTRICT)
  created_at    timestamptz
  unique(user_id, mk_id)
```

- `position`/`notes` stay **off** the `bills` entity table (Phase 1 already removed
  them) and live on `tracked_bills` as the tracker's per-user stance.
- A new Drizzle migration adds these four tables (incremental, following the Phase
  1 migration chain).

---

## 2. Repository Layer

**New:**
- `UsersRepository` — `getSharedUserId()` returns the seeded shared account's id
  (looked up by `label = 'shared'`, cached after first read).
- `TrackedBillsRepository` / `TrackedCommitteesRepository` / `TrackedMksRepository`
  — own the tracking relation for a given `user_id`:
  - `getAll(userId)` → `tracked_* WHERE user_id` ⋈ entity → returns fully-formed
    `Bill[]` / `Committee[]` / `Mk[]`. For bills, `position`/`notes` come from
    `tracked_bills`; the entity reassembly (MK roles/activity/votes, committee
    sessions, derived `party`/`inactive`) reuses the Phase 1 entity repos.
  - `track(userId, entityId, …)` → insert tracking row; idempotent via
    `unique(user_id, entity_id)` (`onConflictDoNothing`/`DoUpdate` for bill
    position/notes).
  - `untrack(userId, entityId)` → delete the tracking row only.

**Reused (Phase 1):** `BillsRepository` / `CommitteesRepository` / `MksRepository`
(entity upserts), `MkListRepository` / `CommitteeListRepository` /
`MkAnnotationsRepository` / `SummariesRepository`, `KnessetConfigRepository`,
`FeatureFlagsRepository` (reworked — see §4).

---

## 3. Route Rewiring

All routes operate against the shared user (`UsersRepository.getSharedUserId()`)
until auth exists.

- **`parliament.ts` `GET /:type`** → `Tracked*Repository.getAll(sharedUserId)`.
- **`tracking.ts`**
  - `POST /add` → parse URL → fetch metadata (unchanged) → `*Repository.upsert`
    the shared entity → `track(sharedUserId, entityId, position?, notes?)`.
  - `DELETE /:type/:id` → `untrack(sharedUserId, id)` (the `id` is the entity id;
    the entity remains in the pool).
- **`bills.ts`** — `/search` unchanged (Knesset OData, live). `/track` → upsert
  bill entity + `track(...)`; the duplicate check becomes "a tracking row exists
  for this user+bill".
- **`committees.ts`** — `/track` → upsert committee entity + `track(...)`. The
  list endpoint already uses `CommitteeListRepository`.

The inline `readItems`/`writeItems`/`readFile`/`writeFile` JSON helpers in these
files are deleted.

---

## 4. Config, Global Feature Flags, Transition Service

### Global feature flags (flat registry)

Feature flags are a **single global registry**, not namespaced per module. The
Phase 1 `feature_flags` table (`name` PK, `enabled`, `value`, `description`,
`updated_at`) is already flat and needs no schema change; only the access layer
changes.

- `FeatureFlagsRepository` is reworked to a flat API:
  - `getAll(): Promise<Record<string, { enabled: boolean; value: string | null }>>`
  - `setFlag(name, enabled, value)`
  - The Phase 1 `getBillsFlags`/`setBillsFlags` and the `BillsFeatureFlags`
    module-namespaced type are removed.
- **`GET /api/feature-flags`** (new) returns the flat global map.
- Consumers read flags **by name**:
  - `knesset-bills.ts` reads `flags['policyFilter'].enabled`,
    `flags['trendingAlgorithm'].value`, `flags['recentRanking'].value` (casting the
    value to its narrow union at the consumption site).
  - `useBillsOverview.ts` fetches `GET /api/feature-flags` and reads
    `policyFilter.enabled` (replacing the static `feature-flags.json` import).

> The visual feature-flag indicator + admin panel is **out of scope** (separate
> follow-up). This phase only adds the endpoint + DB-backed reads that unblock it.

### `knesset_config` + transition service

`server/services/knesset-config.ts` is rewritten to use repositories:
- Reads/writes the current Knesset via `KnessetConfigRepository` (not
  `knesset-config.json`).
- On a Knesset transition: bump `current_knesset` (repo), re-poll to stamp
  `mk_knesset_terms` (MK currency derives from terms — no `mk.inactive` flag
  flipping, no `mks.json` rewrite), and truncate the cache tables via
  `MkListRepository`/`CommitteeListRepository` instead of `unlink`ing cache files.

---

## 5. Poller Rewiring

`server/services/poller.ts` is rewired from JSON to the entity repos:
- Read the shared entity pool (`BillsRepository.getAll`, `CommitteesRepository.
  getAll`, `MksRepository.getAll` with the current Knesset).
- Enrich each entity (Knesset OData + scraper, unchanged logic).
- `upsert` the changed entities via the repos (replacing `writeJson`).
- `hasNewData` and the summaries cache (`SummariesRepository`) behave as today.

The poller operates on entities (the shared pool), independent of who tracks them.

---

## 6. Frontend Changes

- **`src/hooks/useParliament.ts`** — remove the `bills/committees/mks.json`
  imports; initialize `bills`/`committees`/`mks` state to `[]`. The existing
  on-mount `refresh()` already loads from the API; the `loading`/`error` flags are
  unchanged. (A loading skeleton is optional polish, out of scope.)
- **`src/components/parliament/CommitteeCard.tsx`** — remove the `mks.json`
  import; receive tracked MKs as a prop sourced from `useParliament` state
  (threaded from the parent that already holds it).
- **Feature flags become async.** `useBillsOverview.ts` currently reads
  `policyFilterEnabled` **synchronously at module load** (a top-level `const`).
  Moving flags to the API makes this async, so add a small **`useFeatureFlags()`**
  hook that fetches `GET /api/feature-flags` once and returns the flat map (with a
  sensible default before it resolves). `useBillsOverview.ts` consumes that hook
  and reads `policyFilter.enabled`, replacing the static import.

---

## 7. Seed Fixtures + JSON Removal

The seed needs a data source after the runtime JSON is deleted, so the **curated
baseline moves to committed seed fixtures**.

- **Move to `scripts/seed-data/`** (read only by `scripts/seed-db.ts`): `bills`,
  `committees`, `mks`, `knesset-config`, `feature-flags`, `mk-annotations`.
  `seed-db.ts` is updated to read from `scripts/seed-data/` and to also seed the
  shared `users` row (and write `tracked_bills`/`tracked_committees`/`tracked_mks`
  for the shared user from the baseline, since the baseline JSON represents the
  tracked set — bill `position`/`notes` go to `tracked_bills`).
- **Delete from `src/data/`:** `bills.json`, `committees.json`, `mks.json`,
  `knesset-config.json`, `feature-flags.json` (moved), and the now-dormant Phase-1
  caches `knesset-members-cache.json`, `knesset-committees-cache.json`,
  `summaries-cache.json` (pure caches — deleted), `mk-annotations.json` (moved).
- **Kept in `src/data/`:** static content (`about`, `faq`, `gallery`, `site`,
  `primaries`, `protocols`, `representatives`, `updates`, `constitution.ts`) and
  read-only config (`committee-url-mapping.json`, `trending-bills.json`).

After this, no server route, service, or poller reads or writes the mutable JSON,
and the frontend imports none of it.

---

## 8. Testing

- **Repository tests** (pglite harness): for each tracked repo, round-trip
  `track`/`getAll`/`untrack` — assert untrack removes only the tracking row (the
  entity persists), `position`/`notes` round-trip on bills, and
  `unique(user_id, entity_id)` makes `track` idempotent. `UsersRepository`
  returns a stable shared id.
- **Route tests** rewired to seed a pglite DB (shared user + entities) instead of
  mocking `fs`: assert `POST /add` → item appears in `GET /:type`; `DELETE` →
  item gone from the tracked list but the entity row remains. `GET
  /api/feature-flags` returns the flat global map.
- **Poller test** updated to operate on repo-backed entities and assert upserts.
- **Frontend tests** updated: `useParliament` empty-init + API load;
  `CommitteeCard` consuming MKs via prop; `useBillsOverview` fetching flags.

Tests continue to run on in-memory pglite (`NODE_ENV=test`); no Docker needed.

---

## Suggested Implementation Phasing

The plan should sequence so the app stays runnable between tasks:
1. Schema + `users`/`tracked_*` migration + tracked/users repositories (tested).
2. Read path: rewire `parliament.ts` to the tracked repos (DB now serves reads).
3. Write path: rewire `tracking.ts`, `bills.ts`, `committees.ts`.
4. Poller + transition service + `knesset_config`.
5. Global feature flags repo + `GET /api/feature-flags` + `knesset-bills.ts`.
6. Frontend: `useParliament`, `CommitteeCard`, `useBillsOverview`.
7. Seed-fixture move + `seed-db.ts` update + delete runtime JSON. Final verify.

---

## Out of Scope

- Real multi-user accounts, auth, login (item 3). The `users` table + `user_id`
  on tracking is the additive hook; only the single shared account exists now.
- The feature-flag **visual indicator / admin panel** (separate follow-up; this
  phase only adds the endpoint and DB-backed flag reads).
- `trending-bills.json` and `committee-url-mapping.json` stay as read-only config.
- Static content JSON remains as frontend imports.

## Files Touched

**Modified (backend):** `parliament.ts`, `tracking.ts`, `bills.ts`,
`committees.ts`, `poller.ts`, `knesset-config.ts`, `knesset-bills.ts`,
`feature-flags-repository.ts`, `scripts/seed-db.ts`, `server/index.ts` (mount the
feature-flags route).
**Created:** `users` + `tracked_*` schema, a new migration, `UsersRepository`,
`TrackedBillsRepository`/`TrackedCommitteesRepository`/`TrackedMksRepository`, a
feature-flags route, `scripts/seed-data/*`.
**Modified (frontend):** `useParliament.ts`, `useBillsOverview.ts`,
`CommitteeCard.tsx`, `src/types.ts` (drop `BillsFeatureFlags`; add a flag-map type).
**Deleted:** the runtime `src/data/*.json` listed in §7.
**Untouched:** entity/cache schema, static-content and read-only-config JSON.
