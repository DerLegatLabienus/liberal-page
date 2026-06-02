# Closed Committees — Auto-Detect and Mark as Historical

**Status:** Approved design
**Date:** 2026-06-02
**Backlog item:** #5

## Context

The Knesset closes/dissolves committees over the life of a Knesset. The committee
combobox already only offers committees where the Knesset OData `IsCurrent eq true`
filter holds, so a closed committee can never be *newly* tracked. The gap is the
already-tracked case: if a user is tracking a committee and it later closes, nothing
detects it and the card keeps presenting as a live tracker indefinitely.

This feature detects closure for tracked committees and presents them as a historical
record — the card stays in the list with a "Closed" badge, sessions still visible, and
the user removes it manually if they wish. Detection is automatic, cheap, and safe
against transient API failures.

## Detection model

A tracked committee is **closed** when its `oknesset_id` (the Knesset `CommitteeID`)
no longer appears in the active list returned by the OData
`IsCurrent eq true and KnessetNum eq {current}` query.

The `oknesset_id` is stable — it does not change when a committee closes. So closure =
absence from the fresh active list; reopening (transient API gap, same id reappears) =
presence again. A *genuinely* new committee would carry a different `CommitteeID` and
would not match any stored `oknesset_id`, so it can never be mistaken for a reactivation.
(A new Knesset reissues all committee IDs — that is Item #6's concern, out of scope here.)

### Trigger

The committee-list cache (`knesset_committees_cache` table, 1-hour TTL, managed by
`CommitteeListRepository`) is the source of the fresh active list. Detection runs as a
side effect of a **successful** cache refresh.

The cache is refreshed from two places:
1. The existing `/api/committees/list` route, on a stale read (user traffic).
2. **New:** the poller, once per 6-hour cycle, calls the refresh helper. If the cache is
   still fresh it is a no-op; if stale it refetches — the same OData call that would have
   happened on the next combobox open. This guarantees detection fires on a schedule even
   with zero user traffic, adding **no** OData calls beyond what was already scheduled.

### Safety guard (the critical invariant)

Reconciliation marks committees inactive based on *absence* from the active list. If the
OData call returned an empty or truncated list due to an external bug, a naive diff would
mark **every** tracked committee closed.

**Guard:** reconciliation is skipped entirely when the fresh active list has fewer than
`MIN_ACTIVE_COMMITTEES = 10` entries. The Knesset always has dozens of active committees,
so 10 is safely below normal and comfortably above any plausible legitimate low. When the
guard trips (or the fetch failed), all `inactive` flags are left exactly as they were and
detection simply waits for the next refresh.

**Invariant:** a committee's `inactive` flag changes *only* from positive confirmation
against a trustworthy active list — never inferred from a failed, empty, or short fetch.

### Reactivation

Auto. If a previously-inactive committee's `oknesset_id` reappears in a trustworthy active
list, its `inactive` flag is cleared. Because the match is on an identical id, this can only
ever restore the exact same entity — it cannot touch a different committee. This self-heals
transient API gaps.

## Components

### 1. Schema — `server/db/schema/committees.ts`

Add one column:

```ts
inactive: boolean('inactive').notNull().default(false),
```

Generate the migration with `npm run db:generate`. The `Committee` type in `src/types.ts`
already declares `inactive?: boolean`, so no type change is needed.

### 2. Pure reconciliation function (unit-testable, no DB)

New module `server/services/committee-status.ts`:

```ts
export function computeStatusChanges(
  tracked: { oknessetId: string; inactive: boolean }[],
  activeIds: Set<number>,
  minActive: number,
): { deactivate: string[]; reactivate: string[] }
```

- If `activeIds.size < minActive` → return `{ deactivate: [], reactivate: [] }` (safety guard).
- `deactivate`: tracked, currently active, whose id ∉ activeIds.
- `reactivate`: tracked, currently inactive, whose id ∈ activeIds.

This isolates all the decision logic from the database for straightforward unit testing.

### 3. Repository — `CommitteesRepository`

- `getAll()` / `getById()` reassembly: include `inactive` in the returned `Committee`.
- **`upsert()` must NOT write the `inactive` column.** Poller session upserts run constantly;
  they must never reset closure status. Only the method below mutates `inactive`.
- New `reconcileActiveStatus(activeIds: number[]): Promise<{ deactivated: number; reactivated: number }>`:
  reads tracked committees' `{ oknessetId, inactive }`, calls `computeStatusChanges(...)`
  with `MIN_ACTIVE_COMMITTEES`, then applies two targeted `UPDATE`s (set inactive true for
  `deactivate`, false for `reactivate`). Returns counts for logging.

### 4. Refresh helper — extract from the route

Extract the inline OData fetch + URL-mapping + `repo.set()` block from
`server/routes/committees.ts` into a reusable function (new
`server/services/committee-list-refresh.ts`):

```ts
export async function refreshCommitteeListIfStale(): Promise<CommitteeListItem[]>
```

- Returns the cached list if fresh (`getAgeMs() < CACHE_TTL_MS`).
- Otherwise fetches OData, maps URLs, `repo.set(...)`, then calls
  `committeesRepo.reconcileActiveStatus(committeeIds)` and logs the counts.
- The `/list` route becomes a thin wrapper around this helper.
- The poller calls this helper once per cycle.

### 5. Poller — `server/services/poller.ts`

Add one step per cycle: `await refreshCommitteeListIfStale()` (wrapped in its own
try/catch so a committee-list failure never aborts bill/MK polling — consistent with the
existing per-section error handling).

### 6. UI — `CommitteeCard` (`src/components/parliament/CommitteeCard.tsx`)

When `committee.inactive`:
- Render a muted badge beside the name: "סגרה" (he) / "Closed" (en), using the existing
  `Badge` UI primitive with a neutral/muted variant.
- Sessions, summary, and source link remain visible (historical record).
- The remove button stays available for manual cleanup.

Add i18n keys `committee.closed` to `src/locales/he.json` and `src/locales/en.json`.

No other component currently links to committees (the combobox already excludes closed
ones via the API filter), so no further UI changes are in scope.

## Data flow

```
poller cycle (6h)  ─┐
                    ├─→ refreshCommitteeListIfStale()
/api/committees/list ┘        │
   (stale read)               ├─ fresh? → return cache  (no-op)
                              └─ stale? → OData fetch (IsCurrent eq true)
                                            → repo.set(activeList)
                                            → reconcileActiveStatus(activeIds)
                                                 → computeStatusChanges(guard ≥10)
                                                 → UPDATE committees.inactive
GET /api/parliament/committee → CommitteesRepository.getAll() (includes inactive)
                              → useParliament → CommitteeCard → "Closed" badge
```

## Error handling

- OData fetch fails → helper throws; route returns 500 (unchanged); poller logs and
  continues. No flags change.
- Active list `< 10` → `computeStatusChanges` returns empty; no flags change.
- Reconcile `UPDATE` fails → logged; next cycle retries. Cache is still updated.

## Testing

**Unit (`tests/server/committee-status.test.ts`, node env)** — pure function:
- active list missing a tracked id → that id in `deactivate`.
- tracked inactive id reappears in active list → in `reactivate`.
- `activeIds.size < minActive` → both arrays empty (safety guard), even when ids are missing.
- already-inactive id still absent → not in either list (no redundant write).

**Component (`tests/components/CommitteeCard.test.tsx`, happy-dom)**:
- `inactive: true` → "Closed" badge present; sessions still rendered.
- `inactive: false` → no badge.

**Manual smoke:**
- Seed a tracked committee with an `oknesset_id` not in the live active list; run
  `refreshCommitteeListIfStale()` (or wait a poll cycle); confirm `inactive` flips true and
  the card shows the badge. Restore the id; confirm it flips back.

## Out of scope

- New-Knesset transition / mass ID reissue (Item #6).
- Removing or relinking committees from MK cards (no such link exists today).
- Any change to combobox behavior (already filters by `IsCurrent`).
