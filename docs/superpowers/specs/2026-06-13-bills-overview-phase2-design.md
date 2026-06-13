# Design: Knesset Bills Overview — Phase 2 (recentRanking: "progress")

✅ **Implemented 2026-06-13.** `recentRanking: "progress"` is live in `server/services/knesset-bills.ts`. Activate via admin panel (set `recentRanking` flag value to `"progress"`).

## Context

Phase 1 shipped the three-tab Bills Overview with `recentRanking: "newest"` (order by `BillID desc`). The `recentRanking` flag exists in the DB but the backend ignores it — `fetchRecentBills` always uses `BillID desc`. This spec covers switching to `"progress"`: re-rank the Recent tab by the most recent *genuine legislative event* per bill (committee session appearance), so politically active bills surface over newly-introduced but dormant ones.

**Out of scope:** `trendingAlgorithm: "amendments" | "sponsorship"` — those require OData entities verified below (2026-06-13). See "Trending Algorithm Research" section.

## Trending Algorithm Research (live-verified 2026-06-13)

Two OData entities are available for future trending algorithms:

### `KNS_BillUnion` — merged bills
Fields: `BillUnionID`, `MainBillID`, `UnionBillID`, `LastUpdatedDate`. A row means `UnionBillID` was merged INTO `MainBillID`. Count of `MainBillID` appearances = number of bills unified into this bill — a proxy for legislative prominence. Filter: `$filter=MainBillID eq X or MainBillID eq Y or ...`.

**Caveat:** Recent Knesset 25 bills (BillIDs ~1044xxx) return empty results — the unification process takes months; newly-introduced bills have no unions yet. Not useful for trending in the current Knesset until more bills advance.

### `KNS_BillInitiator` — bill initiators / co-sponsors
Fields: `BillInitiatorID`, `BillID`, `PersonID`, `IsInitiator`, `Ordinal`, `LastUpdatedDate`. All entries observed with `IsInitiator=true` (all co-sponsors marked as initiators). Count of `PersonID` per `BillID` = number of co-sponsors. Cross-party sponsorship requires joining `PersonID` to faction data (`KNS_PersonToPosition` or `KNS_MkSiteCode`). Filter: `$filter=BillID eq X or BillID eq Y or ...`.

**Caveat:** Knesset 25 bills may have sparse data depending on how recently the bill was introduced. Verified on historical bills (e.g. BillID=29803 had 7 initiators).

**Implementation note:** both follow the same `or`-filter / pool pattern as `KNS_CmtSessionItem` in the progress-ranking implementation. No architectural surprises.

## OData Schema (live-verified 2026-06-13)

`KNS_CmtSessionItem` actual fields: `CmtSessionItemID`, `ItemID`, `CommitteeSessionID`, `Ordinal`, `StatusID`, `Name`, `ItemTypeID`, `LastUpdatedDate`.

**There is no `BillID` field.** Bills are linked via `ItemID` when `ItemTypeID = 2` (Hebrew: `הצעת חוק`). `ItemTypeID = 2` was verified from `KNS_ItemType`.

`KNS_PlmSessionItem` actual fields: `plmPlenumSessionID`, `ItemID`, `PlenumSessionID`, `ItemTypeID`, `ItemTypeDesc`, `Ordinal`, `Name`, `StatusID`, `IsDiscussion`, `LastUpdatedDate`.

Same pattern — no `BillID` field; bill links are `ItemID` when `ItemTypeID = 2`.

**CommitteeSessionID is sequential (verified):** newer sessions have higher IDs. Latest Knesset 25 sessions: `2244156 → 2026-06-17`, `2244154 → 2026-06-16`. This makes `CommitteeSessionID` a reliable proxy for recency ordering without a separate date lookup.

**Do NOT use** `KNS_Bill.LastUpdatedDate` (administrative-only; caused prior incident where old bills surfaced as recent).

## Open Questions (must be resolved before implementation)

**Q1 — Include plenum sessions?** This is a **fork in the approach** — not just a scope toggle.

- **Committee-only:** `CommitteeSessionID` values are a single sequence and can be compared directly as a recency proxy (higher = newer). One extra OData call.
- **Committee + plenum:** `CommitteeSessionID` and `PlenumSessionID` are *different sequences* and cannot be compared by ID. Real session dates (`StartDate`) would be required — two extra OData calls per request, plus session-date pagination across thousands of Knesset 25 sessions (>500 sessions, paginated at 100/page).

Recommend: **committee-only** (simpler, faster, avoids multi-page pagination; plenum appearances are rarer and most significant bills appear in committee first).

**Q2 — Pool size for "progress" mode?** Fetch `top N` bills by `BillID desc` and re-sort by activity. A larger pool catches more historically active bills at the cost of a wider OData filter. Recommend: **200**.

**Q3 — Bills with no sessions — show or hide?** Bills that have never appeared in committee would sort to the bottom. Recommend: **keep them** (sort to bottom, not hidden), so the tab always returns a full list.

## Approach (committee-only, assuming Q1 answer = committee)

For `recentRanking: "newest"` — no change, current behavior.

For `recentRanking: "progress"`:

1. **Fetch pool** of `top 200` recent bills by `BillID desc` (same OData call as today, larger limit). Collect their `billId` values.

2. **Query `KNS_CmtSessionItem`** filtered by `ItemTypeID eq 2` and the pool's bill IDs:
   ```
   KNS_CmtSessionItem?$filter=ItemTypeID eq 2 and (ItemID eq X1 or ItemID eq X2 or ...)
     &$select=ItemID,CommitteeSessionID&$format=json
   ```
   URL length: 200 IDs × ~20 chars = ~4000 chars. Acceptable. Use `odataGetAllPages` in case results exceed one page.

3. **In-memory**: for each bill, compute `maxCommitteeSessionID = max(CommitteeSessionID for all its appearances)`. Bills not in the result have `maxCommitteeSessionID = 0` (no sessions).

4. **Re-sort** pool descending by `maxCommitteeSessionID`, then return top `limit`.

**Why CommitteeSessionID as proxy:** It is auto-incremented (verified — sequential across Knessets). Comparing by ID is equivalent to comparing by date and eliminates a second round-trip. This only holds for comparing within one sequence; if plenum sessions are added (Q1), real dates would be required.

## Caching

Cache the `Map<billId, maxCommitteeSessionID>` with a **30-minute TTL**, keyed by Knesset number. The pool of 200 bills is deterministic for a given Knesset (same `BillID desc` query), so the cache is stable between requests. New bills introduced in the last 30 min have no committee sessions anyway and sort to the bottom — correct behavior.

Expose `_resetProgressCache()` for tests (same pattern as `_resetBillsCache`).

## Flag Integration

The route handler (`server/routes/bills.ts`) reads `recentRanking` from `FeatureFlagsRepository` and passes it to `fetchRecentBills(limit, ranking)`. No new API surface — `/api/bills/recent` returns the same `KnessetBillOverviewItem[]` shape. Fallback: any unrecognized value falls back to `"newest"`.

## Implementation Plan

**`server/services/knesset-bills.ts`:**

1. Import `odataGetAllPages` from `./odata`.
2. Add `interface CmtSessionItemRaw { ItemID: number; CommitteeSessionID: number }`.
3. Add `let progressCache: { map: Map<number, number>; at: number; knesset: number } | null = null` and `const PROGRESS_TTL = 30 * 60 * 1000`.
4. Add `export function _resetProgressCache() { progressCache = null }`.
5. Add `async function getProgressScoreMap(knesset: number, billIds: number[]): Promise<Map<number, number>>` — builds `billId → maxCommitteeSessionID` using approach above, with cache.
6. Change `fetchRecentBills(limit: number)` → `fetchRecentBills(limit: number, ranking = 'newest')`.
7. In `fetchRecentBills`: if `ranking === 'progress'`, fetch 200-bill pool, call `getProgressScoreMap`, re-sort, return top `limit`. Otherwise existing path.

**`server/routes/bills.ts` — `/recent` handler:**

```typescript
const flags = await new FeatureFlagsRepository().getAll()
const ranking = flags['recentRanking']?.value ?? 'newest'
res.json(await fetchRecentBills(parseLimit(req.query.limit), ranking))
```

**Tests — `tests/server/bills-overview-route.test.ts`:**

New describe block: mock `FeatureFlagsRepository.getAll()` → `recentRanking: "progress"`, mock the `KNS_CmtSessionItem` OData call, assert returned order reflects the maxCommitteeSessionID scores.

## Files Changed

- `server/services/knesset-bills.ts`
- `server/routes/bills.ts`
- `tests/server/bills-overview-route.test.ts`
- `BACKLOG.md` — mark done when shipped

No frontend changes. No schema changes. No new routes.
