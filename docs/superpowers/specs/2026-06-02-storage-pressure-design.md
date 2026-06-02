# Storage Pressure — Graceful Eviction of Stale Tracked Items

**Status:** Approved design
**Date:** 2026-06-02
**Backlog item:** #10

## Context

The app runs on a small Postgres (Neon free tier). All tracked bills/committees/MKs and
their child rows (activity, votes, sessions) plus `summaries_cache` accumulate without
bound. When storage nears the plan cap, adding a new tracked item must not fail silently
or crash. Instead the system evicts the least-recently-used tracked items to keep a
configurable free slack, presents evicted items as re-addable "Discarded" placeholders,
and — if it still cannot make room — surfaces a clear error toast.

There is a **single shared user account** (`users.id = 1`), so "staleness" is recency, not
per-user popularity. Evicting a tracked item removes user-curated data, so the bar is high
and the user is shown what vanished. Regenerating an AI summary costs money, so
`summaries_cache` is preserved until tracked items are exhausted, and the Knesset list
caches (`knesset_*_cache`) are never evicted.

## Decisions (locked during brainstorming)

- **Measure real size via Neon**, not an estimate.
- **Evict LRU tracked items first**, in pure recency order, **regardless of item size**.
- **Re-poll Neon per batch** to decide when enough is freed, with a **circuit breaker**.
- **Last resort:** discard `summaries_cache` oldest-first (only after all tracked items are
  gone). **Never** touch `knesset_members_cache` / `knesset_committees_cache`.
- A **minimal toast** system (none exists today) for the hard-full error.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `STORAGE_LIMIT_MB` | (required for eviction) | Plan cap to stay under. If unset, eviction is disabled (no-op) and adds behave as today. |
| `STORAGE_SLACK_MB` | `2` | Free headroom to maintain: target `usedMB ≤ LIMIT − SLACK`. |
| `EVICTION_BATCH` | `3` | Items discarded per batch before re-polling Neon. |
| `EVICTION_MAX_PER_PASS` | `25` | Circuit breaker: hard cap on evictions in a single `ensureSlack()` call. |
| `EVICTION_LOG_SIZE` | `50` | `eviction_log` ring-buffer size. |
| `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID` | — | Credentials for the Neon size meter (production). |

## Size measurement — `StorageMeter`

```ts
export interface StorageMeter { usedBytes(): Promise<number | null> }
```

- **`NeonApiMeter`** (production): `GET https://console.neon.tech/api/v2/projects/{projectId}/branches/{branchId}`
  with `Authorization: Bearer ${NEON_API_KEY}`, reads `branch.logical_size` (bytes).
  Returns `null` on any failure (network/auth/parse).
- **Test / local stub:** an injectable meter returning a controlled number, so the
  eviction logic is testable in pglite (which has no Neon API).
- **`null` means "unknown"** → `ensureSlack` skips eviction and lets the add proceed. A
  metrics outage must never block tracking.

**Known limitation:** Neon's `logical_size` lags (computed on the pageserver) and does not
drop instantly after deletes. The circuit breaker below makes a lagging reading safe.

## Eviction service — `server/services/storage-manager.ts`

```ts
export async function ensureSlack(meter: StorageMeter): Promise<{ evicted: number; freedCacheRows: number }>
```

Algorithm (real Neon size only — no local byte estimate):
```
limit = STORAGE_LIMIT_MB; if unset → return {0,0}            // eviction disabled
target = (limit - STORAGE_SLACK_MB) * 1MB
used = await meter.usedBytes(); if used === null → return     // unknown → skip
evicted = 0

while used > target AND evicted < EVICTION_MAX_PER_PASS:
  batch = next EVICTION_BATCH LRU tracked items (oldest last_accessed_at, all types merged)
  if batch empty: break
  for item in batch: deleteCascadeAndLog(item); evicted++   // FK-ordered delete + eviction_log
  used = await meter.usedBytes() ?? used                    // re-poll Neon (authoritative)

// Last resort: only if no tracked items remain and still over budget
while used > target AND evicted < EVICTION_MAX_PER_PASS:
  rows = next EVICTION_BATCH oldest summaries_cache rows (by created_at)
  if rows empty: break
  deleteSummaries(rows)
  used = await meter.usedBytes() ?? used
```

**Circuit breaker (the safeguard for "re-poll each batch"):** because Neon's reading lags
within a single request, the loop is bounded by `EVICTION_MAX_PER_PASS` (a count cap, no
size estimate involved) in addition to "Neon reports under target." A lagging reading can
therefore never run away and wipe everything in one add — once the cap is hit the pass
stops, the next add re-polls a (by then updated) Neon size, and the budget converges across
successive adds. `knesset_*_cache` is never a candidate.

### LRU candidate selection

A single query merges the three tracking tables ordered by `last_accessed_at ASC`:
`{ type, entityId, lastAccessedAt }`. Lives in a new `EvictionCandidatesRepository` (or a
method on each tracked repo that the service merges). Pure recency; size is not used for
ordering.

### Safe cascade delete — per entity repo

Each entity repo gains a transactional `deleteCascade(id)` respecting the
`onDelete:'restrict'` FK graph:
- **mk:** delete `mk_activity`, `mk_votes`, `mk_roles`, `mk_knesset_terms`, `tracked_mks` → `mks`.
- **committee:** delete `committee_sessions`, `tracked_committees` → `committees`.
- **bill:** delete `tracked_bills` → `bills`.

The service writes one `eviction_log` row per evicted entity before/after deletion (inside
the same logical operation), capturing re-add info.

## Schema changes (migration)

- Add `last_accessed_at timestamptz NOT NULL DEFAULT now()` to `tracked_bills`,
  `tracked_committees`, `tracked_mks`. Set to `now()` when a track row is created.
- New `eviction_log`:
  | Column | Type | Notes |
  |---|---|---|
  | `id` | serial PK | |
  | `entity_type` | text | `'bill' \| 'committee' \| 'mk'` |
  | `entity_ref` | text | oknesset_id (bill/committee) or knesset_site_id (mk) — to re-fetch |
  | `title` | text | display name |
  | `source_url` | text | for the re-add / link |
  | `evicted_at` | timestamptz | |

  Ring buffer: after insert, delete rows beyond the newest `EVICTION_LOG_SIZE`. Own
  `EvictionLogRepository`. Only tracked-item evictions are logged (summary-cache discards
  are invisible/regenerable, so they are not logged).

## LRU "touch" signal

The drawer loads all tracked items at once, so a bulk read can't feed per-item LRU.
A deliberate per-item interaction updates recency:
- `POST /api/tracking/touch { type, id }` → sets `tracked_<type>.last_accessed_at = now()`
  for the shared user. Returns `204`/`200 {ok}`. Best-effort; failure ignored.
- Frontend fires it (fire-and-forget) when the user clicks a card's "view source"/open
  link in `BillCard` / `CommitteeCard` / `MkCard`.
- New track rows already start at `now()`, so freshly added items are most-recent.

(If this wiring is later deemed unnecessary, eviction degrades to oldest-tracked via the
same column seeded at creation — no structural change.)

## Tracking-add integration

`POST /api/tracking/add` (`server/routes/tracking.ts`):
1. `await ensureSlack(meter)` (best-effort; never throws out — internal errors are logged
   and swallowed so a metrics/eviction problem can't block a normal add).
2. Perform the existing upsert + track.
3. If the insert throws a storage/quota error (DB genuinely full), respond
   `507 { error, code: 'STORAGE_FULL' }`.

## Discarded placeholder UX

- Parliament read exposes the log: extend `GET /api/parliament/:type` response — or add
  `GET /api/parliament/discarded` returning `eviction_log` grouped by type. (Chosen:
  separate endpoint to avoid changing the typed entity arrays.)
- Each drawer tab renders muted **"Discarded"** cards: `title`, type, the label
  "הוסר עקב מגבלת אחסון" / "Removed due to storage limits", and a **Re-add** button →
  `tracking/add` with `entity_ref`/`source_url`. A successful re-add deletes that
  `eviction_log` row (and may itself trigger `ensureSlack`).

## Error toast (new)

No toast system exists. Add a minimal one (no dependency):
- `src/components/ui/toast.tsx` + a `ToastProvider` / `useToast()` and a fixed-position
  `Toaster` (auto-dismiss ~5s, RTL-aware).
- `api-client` surfaces the `STORAGE_FULL` code (it already throws on non-OK; extend to
  carry `code`).
- `HomePage` add handler catches `STORAGE_FULL` and calls
  `toast.error(t('tracker.storage_full'))` → "לא ניתן לשמור — האחסון מלא. נסו להסיר פריט שאינכם צריכים" /
  "Could not save — storage is full. Try removing an item you no longer need." i18n keys added to `he.json`/`en.json`.

## Testing

**Unit / repo (pglite, stubbed meter):**
- `ensureSlack` no-op when `STORAGE_LIMIT_MB` unset, or when `meter.usedBytes()` is `null`.
- Over budget → evicts LRU tracked items oldest-`last_accessed_at` first; writes one
  `eviction_log` row per item; stops when stub meter drops under target.
- Circuit breaker: a meter that never drops stops at `EVICTION_MAX_PER_PASS` (does not wipe
  everything) — proves lag-safety.
- Last resort: with zero tracked items and over budget, discards oldest `summaries_cache`
  rows; never deletes `knesset_*_cache`.
- `deleteCascade` removes all children + tracking row with no FK violation, for each type.
- `eviction_log` ring buffer caps at `EVICTION_LOG_SIZE`.
- `tracking/touch` updates `last_accessed_at`.

**Route (supertest):**
- `tracking/add` calls `ensureSlack` then inserts; returns `507 STORAGE_FULL` when the
  insert fails on a simulated full DB.
- `parliament/discarded` returns logged entries; re-add clears the entry.

**Component:** `Toaster` shows on a `STORAGE_FULL` rejection; a "Discarded" card renders
title + Re-add and calls `tracking/add` on click.

**`NeonApiMeter`:** mock `fetch` — parses `branch.logical_size`; returns `null` on non-OK.

## Out of scope

- Admin/analytics view of evictions (the log is enough for the discarded cards).
- Automatic VACUUM / physical reclamation (Neon manages this; we track logical size).
- Multi-user popularity signals (single shared account).
