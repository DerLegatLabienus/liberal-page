# Design: Knesset Bills Overview — Three-Tab Legislative Feed

## Context

Currently the site shows bills the Liberals faction is tracking. Users need visibility into what's happening across the entire Knesset: recent legislative activity, trending/important bills, and bills aligned with Liberal policy priorities. A single overview section with three tabbed views provides comprehensive parliamentary context without cluttering the page.

## Requirements

1. **Three tabs**: "All Recent Bills" / "Trending" / "Policy-aligned Bills"
2. **Compact + Rich display**: Standard view shows ~10 bills (title, status, last update); expandable inline for rich details
3. **Manual trending** by default, with feature flags to swap algorithms later (recent activity, amendment velocity, sponsorship)
4. **Same window layout**: All content fits in one scrollable section, expandable rows show details inline
5. **Data sources**: Manual JSON (trending), Knesset OData API live queries (recent, policy-aligned)

## Verified API Constraints

Confirmed against the live Knesset OData API during design:

- **`$orderby` is supported** (used elsewhere for `KNS_CommitteeSession`), so server-side ordering works.
- **`SummaryLaw` field exists** on `KNS_Bill` → provides real summary text for the expanded view.
- **`substringof(...)` filtering works** (used by `/api/bills/search`) → drives keyword-based "policy-aligned" tab.
- **Status is numeric only**: `KNS_Bill` has `StatusID` (number) but **no `StatusDesc`**. The `KNS_Status` lookup entity exists and maps `StatusID → Desc` (Hebrew); `TypeID eq 2` are bill statuses (e.g. 101 → "הכנה לקריאה ראשונה"). The status map is built by querying `KNS_Status` once and caching it — no hardcoded guesses.
- **Committee is numeric only**: `KNS_Bill.CommitteeID` is an ID, not a name. Resolve via the existing `knesset-committees-cache.json`, or omit committee name in v1.

### Recency signal — known trap (from prior incident)

`KNS_Bill.LastUpdatedDate` and `KNS_BillHistoryInitiator.LastUpdatedDate` reflect **administrative** updates, not real legislative activity. Ordering by them previously surfaced **old bills as "recent"** — the team switched away from this. **Do not order the Recent tab by `LastUpdatedDate`.**

- **Recent v1 (this spec / Phase 1):** order by `BillID` descending — newest-introduced bills, Knesset-wide. Simple, avoids the trap.
- **Recent v2 (Phase 2, separate spec):** re-rank by the most recent *genuine legislative event* per bill. Verified-available building blocks: `KNS_CmtSessionItem` (`ItemID`/`ItemTypeID` + `CommitteeSessionID`) joins bills to committee sessions, which carry reliable `StartDate`; `KNS_PlmSessionItem` joins bills to plenum sessions (votes/discussions). Aggregating "latest real event per bill" across these is a backend subsystem in its own right — out of scope here, gated behind the `recentRanking` flag.

**No amendment-count or sponsor fields** on `KNS_Bill`. The "amendments" and "sponsorship" trending algorithms require other OData entities that are not verified — out of scope (see Feature Flags below).

## Architecture

### Data Layer

**`src/data/trending-bills.json`** — manually curated list, edited by admins to reflect current political importance.

```json
{
  "$comment": "Trending bills curated by the Liberals faction. Each entry uses the Knesset OData BillID (same value as Bill.number and BillSearchResult.billId). Admin picks ~10 important bills per week. title/reason are cached display copy so the curated list renders even before the live OData fetch resolves.",
  "bills": [
    {
      "billId": 1044632,
      "title": "הצעת חוק לתיקון פקודת מס הכנסה (מס' 285) (נכס דיגיטלי), התשפ\"ו-2026",
      "reason": "סוגייה ליברלית חשובה — מס על נכסים דיגיטליים"
    }
  ]
}
```

**`src/data/feature-flags.json`** — toggles trending algorithm and policy filter. Placed in `src/data/` to match the existing `knesset-config.json` precedent (importable by the frontend, readable by the server via `fs`).

```json
{
  "bills": {
    "$comment": "Feature flags for bills overview section",
    "trendingAlgorithm": "manual",
    "$trendingAlgorithm_comment": "Implemented now: 'manual' (curated list from trending-bills.json). NOT yet implemented (require unverified OData entities): 'amendments', 'sponsorship' — backend falls back to 'manual' if these are set. Changing this switches the data source without code changes.",
    "recentRanking": "newest",
    "$recentRanking_comment": "Controls the Recent tab ordering. 'newest' (Phase 1, implemented): KNS_Bill ordered by BillID desc = newest-introduced bills. 'progress' (Phase 2, NOT implemented): re-rank by most recent genuine legislative event (committee/plenum session dates). Backend falls back to 'newest' if set to 'progress' before Phase 2 ships.",
    "policyFilterEnabled": true,
    "$policyFilterEnabled_comment": "If true, the 'Policy-aligned' tab filters Knesset bills by Liberal keywords (חירות, שוק חופשי, זכויות אזרח, וכו'). If false, the tab is hidden. The frontend imports this flag to decide whether to render the tab; the backend reads it to guard the route."
  }
}
```

### API Routes

New routes live under `/api/bills/*`, co-located with the existing `/api/bills/search` and `/api/bills/track` (NOT under `/api/parliament/*`, whose `/:type` route would parse `bills` as a tracking type and 400). Each queries the Knesset OData API live (same pattern as `/api/bills/search`), wrapped in a short in-memory TTL cache (~5 min) to avoid hammering OData. No new on-disk cache file is introduced.

- **`GET /api/bills/recent?limit=10`** — `KNS_Bill?$filter=KnessetNum eq {current}&$orderby=BillID desc&$top={limit}&$select=BillID,Name,StatusID,CommitteeID,LastUpdatedDate,SummaryLaw`. `BillID desc` = newest-introduced bills (Recent v1; see "Recency signal" above — `LastUpdatedDate` is deliberately NOT used for ordering). Returns `{ billId, title, statusId, status, committee, lastUpdatedDate, summary, knessetUrl }[]` (status/committee resolved server-side — see below).
- **`GET /api/bills/trending`** — returns curated `trending-bills.json` when `trendingAlgorithm` is `manual` (the only implemented value), each entry hydrated with live status/summary from OData. Unimplemented algorithms fall back to `manual`.
- **`GET /api/bills/policy-aligned?limit=10`** — `KNS_Bill` filtered by `substringof` against the Liberal keyword list, ordered by `BillID desc` (newest matching bills; `LastUpdatedDate` is deliberately avoided). Hidden entirely when `policyFilterEnabled` is false.

**Server-side enrichment** (shared helper): map numeric `StatusID` → Hebrew label via a hardcoded status-code map (`src/data` or a small server module), and resolve `CommitteeID` → committee name via the existing `knesset-committees-cache.json`. Unknown status/committee falls back to an empty string.

### Component Structure

**`KnessetBillsOverview`** (new section, lives in `src/components/sections/`)
- Fetches bills from three API routes on mount
- Owns tab state (which tab is active)
- Renders `BillsTabs` (tab bar) + `BillsList` (content)

**`BillsTabs`** (stateless)
- Tab buttons: "All Recent" / "Trending" / "Policy-aligned"
- Calls parent's `onTabChange(tabId)`

**New type** (`src/types.ts`): `KnessetBillOverviewItem` — distinct from the tracked `Bill` (which carries cell-specific fields like `position`, `notes`, `hasNewData`). Shape:
```ts
interface KnessetBillOverviewItem {
  billId: number
  title: string
  statusId: number
  status: string        // Hebrew label mapped from statusId; '' if unknown
  committee: string     // resolved name; '' if unresolved
  lastUpdatedDate: string
  summary: string       // SummaryLaw; may be ''
  knessetUrl: string
  reason?: string       // only present for curated trending items
}
```

**`BillsList`** (stateless)
- Props: `bills: KnessetBillOverviewItem[]`, `isLoading`, `error`
- Renders up to `limit` bills as `BillRow` components
- Scrollable container if the list overflows

**`BillRow`** (expandable)
- Props: `bill: KnessetBillOverviewItem`, `isExpanded`, `onToggle`
- **Compact view** (default):
  - Bill title (one line, truncated)
  - Status badge (the mapped Hebrew label — note this is the full Knesset status set, not just the four tracked-bill statuses; hidden if status is '')
  - Last updated date (e.g. "2 days ago")
  - Click to expand
- **Expanded view** (inline):
  - Full title
  - Status (mapped from `StatusID`) + committee name (resolved from `CommitteeID`, if available)
  - Summary from the `SummaryLaw` field (may be empty for some bills — render only if present)
  - Last updated date (`LastUpdatedDate`)
  - For curated trending bills: the admin-authored `reason`
  - Link to the official Knesset bill page
  - Close/collapse button

  Note: "recent amendments/actions history" is intentionally excluded — `KNS_Bill` exposes no such field, and the history would require additional unverified OData entities. All expanded data comes from the single `KNS_Bill` record already fetched.

### Data Flow

```
KnessetBillsOverview (mount)
  ├─ fetch /api/bills/recent
  ├─ fetch /api/bills/trending
  └─ fetch /api/bills/policy-aligned   (skipped if policyFilterEnabled is false)
       ↓
    update state: { allRecent[], trending[], policyAligned[] }
       ↓
    BillsList renders active tab's array
       ↓
    user clicks BillRow
       ↓
    BillRow expands inline (no new fetch needed, data already loaded)
```

### Error Handling

- If any tab's API call fails: show error message + retry button for that tab only
- If all three fail: show "Unable to load bills" message with instructions to try again
- Timeouts: 10-second timeout per request; log failures to console for debugging

### Feature Flag Implementation

Two independent flags in `src/data/feature-flags.json`:

**`trendingAlgorithm`** controls `/api/bills/trending`:
- `"manual"` *(default, implemented)*: returns `src/data/trending-bills.json`, hydrated with live status/summary from OData
- `"amendments"` *(not implemented)*: would need a per-bill amendment count, not a field on `KNS_Bill`; requires research into other OData entities. Backend falls back to `manual`.
- `"sponsorship"` *(not implemented)*: would need a bill-initiator join (cross-party co-sponsors); entity unverified. Backend falls back to `manual`.

**`recentRanking`** controls `/api/bills/recent`:
- `"newest"` *(default, implemented)*: `KNS_Bill` ordered by `BillID` descending — newest-introduced bills
- `"progress"` *(not implemented, Phase 2)*: re-rank by most recent genuine legislative event (committee/plenum session dates per `KNS_CmtSessionItem` / `KNS_PlmSessionItem`). Backend falls back to `newest`.

Unimplemented values are reserved names so the flag contract is stable; implementing them is a follow-up. No code changes are needed to swap between implemented values — edit the flag and restart the backend.

## Integration

**Where it appears:** Rendered inside the parliamentary area, directly below the existing parliamentary tracker. Like the rest of that area, it is gated to Hebrew (`i18n.language === 'he'`) per the established pattern — the content is Knesset Hebrew text, so it does not render in the English view.

**Styling:** Follows existing card patterns (RTL, dark theme support, mobile responsive).

**Localization:** Bill titles come from the Knesset API as Hebrew text. Status labels are NOT provided by the API — they are mapped from numeric `StatusID` to Hebrew via our own status-code map. Admin-added `reason` strings in `trending-bills.json` are authored in Hebrew. Because the whole section is Hebrew-gated, no English locale strings are needed for v1.

## Testing

- Unit tests: `BillRow` expand/collapse state; per-tab error/retry state rendering; StatusID→label mapping helper
- Integration: Mock OData responses for all tabs, verify each tab renders the correct bills and that `policyFilterEnabled: false` hides the policy tab
- Manual: Verify expand interaction, link navigation, and responsive layout on mobile

## Future Enhancements

- Search/filter within a tab
- Sort options (by date, status, committee)
- Notification alerts when a tracked bill appears in trending
- Export bills to calendar/email digest
