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
  vs the `storagePressure` flag's `limit`. Runs **on each poll cycle**.
- **Delete only entities tracked by no one** — determined from the tracking tables, so it is
  correct for any number of users. Genuinely-tracked items are never touched (no LRU).
- **Also delete `summaries_cache` rows for orphaned committees** (matched by the committee's
  session document URL). API list caches (`knesset_members_cache`,
  `knesset_committees_cache`) are never touched.
- **Log every deletion to the server log** (console). No DB log table, no discarded-card UI,
  no toast.
- **Shed the minimum, hold extracted info as long as possible:** when over budget, delete at
  most a **bounded batch** of the **stalest** orphans (oldest `lastPolledAt`) per cycle —
  never all at once. Successive cycles chip away only as needed, so already-extracted data
  (summaries, activity, votes) is preserved as long as possible.
- **No mid-cycle re-measure:** `pg_database_size` lags after deletes, so we measure once per
  cycle and delete at most one batch; the next cycle re-measures after the size has settled.

## Configuration

Driven by the **`storagePressure` feature flag** (in the existing `feature_flags` table,
DB-seeded, **on by default**) — not env vars, so it is runtime-tunable without a redeploy.

| Knob | Where | Default | Meaning |
|---|---|---|---|
| limit + slack | `storagePressure` flag `value` | `"450:2"` | `"limitMb:slackMb"`. Purge when `usedMB > limit − slack`. `value = "-1"` **disables**. If the flag row is absent, the default `"450:2"` keeps it on. |
| batch size | `ORPHAN_PURGE_BATCH` env | `5` | Max orphans deleted per poll cycle (stalest first). Optional override only. |

No new schema, columns, or tables (the flag reuses `feature_flags`). The flag row is seeded
two ways: a data migration (`0008_storage_pressure_flag.sql`, idempotent
`INSERT … ON CONFLICT DO NOTHING`) so existing/production DBs get it automatically on boot,
and `seed-db` for fresh seeded databases.

## Size measurement

A small helper `getDatabaseSizeBytes(): Promise<number | null>` runs
`SELECT pg_database_size(current_database())`. Returns `null` on error or when the function
is unavailable (e.g. pglite in tests). The orphan purge takes the size source as an injected
function so tests can stub it; production passes `getDatabaseSizeBytes`.

`pg_database_size` lags after deletes (MVCC), so we measure exactly **once per poll cycle**
and delete at most one bounded batch — never looping on the figure within a cycle. The next
cycle re-measures (by then VACUUM has typically run) and sheds another batch if still over.

## Orphan detection (multi-user safe)

An entity is an **orphan** when no row in its tracking table references it — i.e. tracked by
zero users. Computed directly with a `NOT EXISTS` / anti-join query against `tracked_bills` /
`tracked_committees` / `tracked_mks`, so it is exact regardless of user count; no
denormalized counter to maintain or drift.

New repository methods return each orphan's `lastPolledAt` so the service can order by
staleness across all types:
- `BillsRepository.findUntracked(): Promise<{ id: number; lastPolledAt: Date | null }[]>`
- `CommitteesRepository.findUntracked(): Promise<{ id: number; lastPolledAt: Date | null; documentUrl: string | null }[]>`
  (`documentUrl` = `lastSessionDocumentUrl`, so summaries can be matched)
- `MksRepository.findUntracked(): Promise<{ id: number; lastPolledAt: Date | null }[]>`

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
cfg = parsePressureValue(flags['storagePressure']?.value)   // "limitMb:slackMb"; default "450:2"
if cfg === null → return zeros                               // flag value "-1" → disabled
used = await usedBytes(); if used === null → return zeros    // size unknown → skip
if used <= (cfg.limitMb - cfg.slackMb) * 1MB → return zeros  // have slack → nothing to do

// Over budget → shed at most ORPHAN_PURGE_BATCH stalest orphans (tracked by no one).
candidates = [
  ...billsRepo.findUntracked().map(o => ({ type:'bill', ...o })),
  ...committeesRepo.findUntracked().map(o => ({ type:'committee', ...o })),
  ...mksRepo.findUntracked().map(o => ({ type:'mk', ...o })),
]
candidates.sort(by lastPolledAt ASC, null first; tie-break id ASC)   // stalest first
for c in candidates.slice(0, ORPHAN_PURGE_BATCH):
  if c.type === 'committee': summariesRepo.deleteBySourceUrl(c.documentUrl)
  repo[c.type].deleteCascade(c.id); log(c.type, c.id)
// no re-measure; the next poll cycle sheds another batch if still over budget
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
- Disabled when the flag value is `"-1"`; **on by default** when the flag row is absent
  (uses `"450:2"`); no-op when `usedBytes()` returns `null` or when under budget.
- Over budget → deletes **at most `ORPHAN_PURGE_BATCH`** orphans, **stalest first** (oldest
  `lastPolledAt`, nulls first, tie-break id); leaves the remaining orphans for later cycles.
- A second call (still over budget) sheds the next batch — proves cross-cycle convergence and
  that extracted data isn't wiped in one pass.
- Tracked entities are never deleted.
- **Multi-user:** an entity tracked by user B is NOT deleted after user A untracks it
  (`findUntracked` excludes it because a tracking row still exists).
- Orphan committee in the batch → its `summaries_cache` row (matching `documentUrl`) deleted;
  an unrelated summary is kept; `knesset_*_cache` rows are untouched.
- `deleteCascade` removes all children + any tracking row with no FK violation, per type.
- Emits a server-log line per deletion (spy on `console.log`).

**Route (supertest):** existing `tracking` add/remove tests stay green (untrack still just
removes the tracking row; the entity is reclaimed later by the poller sweep).

## Operational caveat — verify the size signal

The feature is **on by default** (the seeded `storagePressure` flag `"450:2"`, or the same
built-in default when the flag row is absent). To disable it, set the flag value to `"-1"`.
The high default cap (450 MB) means it does nothing until the DB actually grows near that
size, so "on by default" is safe for a small DB. Tune `limitMb` to the deployment's plan.

**Confirm `pg_database_size` actually drops after deletes on the target DB.** Plain `DELETE` creates dead tuples; ordinary
(auto)VACUUM marks them reusable but does **not** shrink the on-disk size that
`pg_database_size` reports — only `VACUUM FULL`/repack does. If the metric is effectively
monotonic between full vacuums (verify on Neon, whose storage architecture is non-standard),
then while over budget every cycle will shed another batch until **all** orphans are gone —
degrading "shed the minimum" into a gradual full orphan-GC. This is still safe (only
untracked garbage is ever deleted; tracked data is never touched), but if that behavior is
undesirable, switch the size signal to one that reflects deletes immediately (row count or a
content-byte estimate) — accepting it is an estimate rather than real bytes.

**Known minor leak:** `deleteBySourceUrl(lastSessionDocumentUrl)` reclaims only the orphan
committee's *latest* session summary; summaries from older sessions of the same committee
are left in `summaries_cache`.

## Out of scope (revisit only if orphan purging proves insufficient)

- Evicting genuinely-tracked items (LRU, discarded placeholders, error toast).
- Real-time/Neon-API size measurement.
- Purging bill or MK document summaries (only committee summaries are in scope here).
- VACUUM / physical reclamation (Postgres/Neon handles this; we act on logical pressure).
