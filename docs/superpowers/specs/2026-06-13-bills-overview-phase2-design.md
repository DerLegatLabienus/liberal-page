# Design: Knesset Bills Overview — Phase 2 (recentRanking: "progress")

## Context

Phase 1 shipped the three-tab Bills Overview with `recentRanking: "newest"` (order by `BillID desc`). The `recentRanking` flag exists in the DB but the backend ignores it — `fetchRecentBills` always uses `BillID desc`. This spec covers switching to `"progress"`: re-rank the Recent tab by the most recent *genuine legislative event* per bill (committee or plenum session date), so politically active bills surface over newly-introduced but dormant ones.

**Out of scope:** `trendingAlgorithm: "amendments" | "sponsorship"` — those require unverified OData entities and are not addressed here.

## Data Sources (verified in Phase 1 spec)

- `KNS_CmtSessionItem` — links bills to committee sessions via `BillID` + `CommitteeSessionID`
- `KNS_CommitteeSession` — carries `StartDate` (reliable) and `KnessetNum`
- `KNS_PlmSessionItem` — links bills to plenum sessions via `BillID` + `PlenumSessionID`
- `KNS_PlenumSession` — carries `StartDate` and `KnessetNum`

**Do NOT use** `KNS_Bill.LastUpdatedDate` (administrative-only; caused prior incident where old bills surfaced as recent).

## Approach: Two-Query In-Memory Aggregation

For `recentRanking: "newest"` — no change, current behavior.

For `recentRanking: "progress"`:

1. **Fetch all committee session items for the current Knesset** (one OData call, paginated):
   ```
   KNS_CmtSessionItem?$filter=KnessetNum eq {k}&$select=BillID,CommitteeSessionID&$format=json
   ```
   Result: `Array<{ BillID: number, CommitteeSessionID: number }>`

2. **Fetch all committee session dates for the current Knesset** (one OData call, paginated):
   ```
   KNS_CommitteeSession?$filter=KnessetNum eq {k}&$select=CommitteeSessionID,StartDate&$format=json
   ```
   Result: `Array<{ CommitteeSessionID: number, StartDate: string }>`

3. **In-memory join**: build `Map<CommitteeSessionID → StartDate>`, then for each bill compute `maxDate = max(StartDate for all its sessions)`.

4. **Optionally repeat for plenum** (steps 1-3 with `KNS_PlmSessionItem` + `KNS_PlenumSession`). Bills in the plenum are fewer and this doubles coverage.

5. **Fetch recent bills by `BillID desc`** (current behavior, larger pool — e.g. top 200), then re-sort by `progressDate desc`, take top N. Bills with no recorded sessions sort to the bottom (date `'0'`).

**Why this approach over per-bill lookups:**
- N+1 OData calls per bill would be ~100+ round trips for a 10-bill display
- The session tables are O(thousands) rows per Knesset — a one-time paginated fetch is fast and cacheable
- The join is trivial in memory

## Caching

Both session tables change as the Knesset works, but not minute-to-minute. Cache with a **30-minute TTL** (longer than the 5-min bill cache), keyed by Knesset number. Cache is held in-process alongside the existing `committeeMapCache` pattern in `knesset-bills.ts`.

Expose `_resetProgressCache()` for tests (same pattern as `_resetBillsCache`).

## Flag Integration

The backend reads `recentRanking` from `FeatureFlagsRepository` on each request (already cached by `featureFlagsRepo.getAll()` upstream). No new API surface — `/api/bills/recent` returns the same `KnessetBillOverviewItem[]` shape regardless of ranking. The frontend `useBillsOverview` calls `api.bills.recent(10)` unchanged.

Fallback: any unrecognized value falls back to `"newest"`.

## Implementation Plan

All changes in `server/services/knesset-bills.ts`:

1. Add types `CmtSessionItem`, `CmtSession`, `PlmSessionItem`, `PlmSession`.
2. Add `progressCache: { map: Map<number, string>; at: number } | null` (bill-id → latest event ISO date).
3. Add `getProgressDateMap(knesset): Promise<Map<number, string>>` — runs both fetches, joins, caches.
4. In `fetchRecentBills`:
   - Read `recentRanking` flag from `FeatureFlagsRepository`.
   - If `"progress"`: fetch a larger pool (top 200 by `BillID desc`), call `getProgressDateMap`, re-sort, return top `limit`.
   - If `"newest"` (or unknown): existing path unchanged.
5. Add `_resetProgressCache()` export.

Tests in `tests/server/bills-overview-route.test.ts`:
- Existing tests: unaffected (flag defaults to `"newest"`).
- New describe block: mock `FeatureFlagsRepository.getAll()` to return `recentRanking: "progress"`, mock the two extra OData fetches, assert the returned order reflects the session dates.

## Open Questions (needs your input before implementation)

1. **Include plenum sessions?** Querying `KNS_PlmSessionItem` + `KNS_PlenumSession` doubles the OData calls but gives a more complete signal. Plenum sessions are where bills get voted on — arguably the most important activity. Recommend: **yes, include both**.

2. **Pool size for "progress" mode?** We fetch `top 200` bills by `BillID desc` and re-sort by activity. If a bill introduced 3 months ago had recent committee activity, it could rank first — but only if it's within the top 200 newest bills. A larger pool catches more historically active bills; a smaller pool is faster. Recommend: **200**, but this is configurable.

3. **Bills with no sessions — show or hide?** In "progress" mode, bills that have never appeared in a session will sort to the bottom. They are still valid bills (just introduced, not yet assigned). Recommend: **keep them** (sort to bottom, not hidden), so the tab always returns a full list even for a new Knesset.

## Files Changed

- `server/services/knesset-bills.ts` — main logic (new `getProgressDateMap`, updated `fetchRecentBills`)
- `tests/server/bills-overview-route.test.ts` — new test describe block
- `BACKLOG.md` — mark `recentRanking: "progress"` as done

No frontend changes. No schema changes. No new routes.
