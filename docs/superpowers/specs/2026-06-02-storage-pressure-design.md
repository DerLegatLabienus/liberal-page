# Storage Pressure — Purge Orphaned (Untracked) Entities

**Status:** Approved design
**Date:** 2026-06-02
**Backlog item:** #10

## Context

The app runs on a small Postgres. `untrack` (`DELETE /api/tracking/:type/:id`) deletes only
the `tracked_*` row — the entity (`bills`/`committees`/`mks`) and all its child rows
(activity, votes, roles, terms, sessions) are left behind as **orphans**. Over time these
accumulate and waste storage with data no one is using.

This feature reclaims that space: **when the database is near its limit, delete entities
that no user tracks** (plus their children, and — for committees — their cached session
summaries). It is deliberately minimal. If purging orphans is not enough (the DB fills with
genuinely-tracked data), that is out of scope for now — we will revisit with a different
strategy.

## Decisions (locked during brainstorming)

- **Trigger only under storage pressure**, measured by `pg_database_size(current_database())`
  vs `STORAGE_LIMIT_MB`. Runs **on each poll cycle**.
- **Delete only entities tracked by no one** — determined from the tracking tables, so it is
  correct for any number of users. Genuinely-tracked items are never touched (no LRU).
- **Also delete `summaries_cache` rows for orphaned committees** (matched by the committee's
  session document URL). API list caches (`knesset_members_cache`,
  `knesset_committees_cache`) are never touched.
- **Log every deletion to the server log** (console). No DB log table, no discarded-card UI,
  no toast.
- Once pressure is detected, **purge all orphans in one pass** — they are pure garbage, so
  there is no batching, re-poll loop, or size-lag concern.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `STORAGE_LIMIT_MB` | unset | DB size cap. **If unset, the feature is a no-op** (opt-in). |
| `STORAGE_SLACK_MB` | `2` | Headroom: purge when `usedMB > LIMIT − SLACK`. |

No new schema. No new columns. No new tables.

## Size measurement

A small helper `getDatabaseSizeBytes(): Promise<number | null>` runs
`SELECT pg_database_size(current_database())`. Returns `null` on error or when the function
is unavailable (e.g. pglite in tests). The orphan purge takes the size source as an injected
function so tests can stub it; production passes `getDatabaseSizeBytes`.

`pg_database_size` lags after deletes (MVCC), but that is irrelevant here: we measure once
per poll cycle, and when over budget we purge *all* orphans in a single pass rather than
looping on the figure. The next cycle re-measures (by then VACUUM has typically run).

## Orphan detection (multi-user safe)

An entity is an **orphan** when no row in its tracking table references it — i.e. tracked by
zero users. Computed directly with a `NOT EXISTS` / anti-join query against `tracked_bills` /
`tracked_committees` / `tracked_mks`, so it is exact regardless of user count; no
denormalized counter to maintain or drift.

New repository methods:
- `BillsRepository.findUntrackedIds(): Promise<number[]>`
- `CommitteesRepository.findUntracked(): Promise<{ id: number; documentUrl: string | null }[]>`
  (returns `lastSessionDocumentUrl` so summaries can be matched)
- `MksRepository.findUntrackedIds(): Promise<number[]>`

## Safe cascade delete (respects `onDelete:'restrict'` FKs)

Each entity repo gains a transactional `deleteCascade(id)`:
- **mk:** delete `mk_activity`, `mk_votes`, `mk_roles`, `mk_knesset_terms`, `tracked_mks` → `mks`.
- **committee:** delete `committee_sessions`, `tracked_committees` → `committees`.
- **bill:** delete `tracked_bills` → `bills`.

(`tracked_*` rows are absent for orphans, but the delete is included to keep `deleteCascade`
correct as a general primitive and future-proof against multi-user partial untracks.)

## Service — `server/services/storage-manager.ts`

```ts
export async function purgeOrphansIfNeeded(
  usedBytes: () => Promise<number | null>,
): Promise<{ purged: { bills: number; committees: number; mks: number }; summariesDeleted: number }>
```

Logic:
```
limit = STORAGE_LIMIT_MB; if unset → return zeros          // feature off
used = await usedBytes(); if used === null → return zeros   // size unknown → skip
if used <= (limit - STORAGE_SLACK_MB) * 1MB → return zeros  // have slack → nothing to do

// Over budget → purge ALL orphans (safe; tracked by no one)
for id in mksRepo.findUntrackedIds():        mksRepo.deleteCascade(id);        log('mk', id)
for c  in committeesRepo.findUntracked():     summariesRepo.deleteBySourceUrl(c.documentUrl)
                                              committeesRepo.deleteCascade(c.id); log('committee', c.id)
for id in billsRepo.findUntrackedIds():       billsRepo.deleteCascade(id);      log('bill', id)
```

- `SummariesRepository.deleteBySourceUrl(url)` — deletes `summaries_cache` rows whose
  `sourceUrl` equals the committee's session document URL; no-op for `null`/empty.
- Each deletion logs one line, e.g.
  `Storage GC: purged orphan committee 7 (ועדת הכספים) + 1 summary`.
- API list caches are never queried or deleted here.

## Poller integration — `server/services/poller.ts`

Add a step in `runPollCycle`, in its own try/catch (a GC failure must not affect the entity
polls or cycle success):
```ts
try { await purgeOrphansIfNeeded(getDatabaseSizeBytes) }
catch (err) { console.error('Poller: orphan purge failed:', err) }
```
Not counted toward cycle success/backoff (consistent with the committee-list refresh step).

## Testing

**Unit / repo (pglite, stubbed `usedBytes`):**
- No-op when `STORAGE_LIMIT_MB` unset, when `usedBytes()` returns `null`, or when under budget.
- Over budget → deletes entities with no tracking row; leaves tracked entities intact.
- **Multi-user:** an entity tracked by user B is NOT deleted after user A untracks it
  (`findUntracked*` excludes it because a tracking row still exists).
- Orphan committee → its `summaries_cache` row (matching `documentUrl`) deleted; an unrelated
  summary is kept; `knesset_*_cache` rows are untouched.
- `deleteCascade` removes all children + any tracking row with no FK violation, per type.
- Emits a server-log line per deletion (spy on `console.log`).

**Route (supertest):** existing `tracking` add/remove tests stay green (untrack still just
removes the tracking row; the entity is reclaimed later by the poller sweep).

## Out of scope (revisit only if orphan purging proves insufficient)

- Evicting genuinely-tracked items (LRU, discarded placeholders, error toast).
- Real-time/Neon-API size measurement.
- Purging bill or MK document summaries (only committee summaries are in scope here).
- VACUUM / physical reclamation (Postgres/Neon handles this; we act on logical pressure).
