# Knesset MK Scraper — Design Spec

**Date:** 2026-05-16
**Status:** Approved
**Project:** `/home/aavitan/claude-projects/liberal-page`

---

## Problem

The existing MK tracking code (`knesset-api.ts`) handles identity resolution (SiteId → KnsID → name/faction) but does not fetch recent activity. The hand-crafted activity data in `mks.json` contained outdated 2022 bills. Activity must be fetched live from the Knesset OData API, sorted newest first, and stored in `mks.json`.

---

## Scope

A new standalone module `server/services/knesset-scraper.ts` that fetches MK activity from the Knesset OData API. Integrated into the tracking route (on add) and the poller (on refresh). `mks.json` remains the persistent local data store.

**In scope:** bills initiated, parliamentary questions.
**Out of scope:** votes (endpoint unreliable), committee sessions (inconsistent data), committees, bills tracking (separate sub-projects).

---

## New Module: `server/services/knesset-scraper.ts`

Single responsibility: fetch and shape MK activity data. No identity resolution (that stays in `knesset-api.ts`).

### Public API

```ts
/**
 * Fetch MK activity (bills initiated + parliamentary questions)
 * from Knesset OData, merged and sorted newest first.
 *
 * @param knsId  Internal Knesset PersonID
 * @param limit  Max items to return (default 10)
 */
export async function fetchMkActivity(knsId: number, limit = 10): Promise<MkActivity[]>
```

### Internal functions

```ts
// Bills initiated — sorted by LastUpdatedDate desc (no KnessetNum filter; newest-first ordering makes old bills naturally fall off the 20-item cap)
async function fetchMkBills(knsId: number): Promise<MkActivity[]>
// → KNS_BillInitiator?$filter=PersonID eq {knsId}&$expand=KNS_Bill&$orderby=LastUpdatedDate desc&$top=20

// Parliamentary questions — sorted by SubmitDate desc
async function fetchMkQuestions(knsId: number): Promise<MkActivity[]>
// → KNS_Query?$filter=PersonID eq {knsId}&$orderby=SubmitDate desc&$top=10
```

### fetchMkActivity logic

1. Fetch bills and questions in parallel (`Promise.allSettled` — one failing doesn't kill the other)
2. Map each to `MkActivity`:
   - Bill: `type='bill_initiated'`, `date=LastUpdatedDate`, `title=KNS_Bill.Name`, `detail=KNS_Bill.SubTypeDesc`
   - Question: `type='question'`, `date=SubmitDate`, `title=Name`, `detail=TypeDesc`, `sourceUrl=https://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Query({QueryID})`
3. Merge arrays, sort by `date` descending
4. Return first `limit` items

### Type addition

Add `'question'` to `MkActivityType` in `src/types.ts`:

```ts
export type MkActivityType = 'bill_initiated' | 'vote' | 'duty_change' | 'question'
```

---

## Integration

### `POST /api/tracking/add` (mk case)

After resolving identity via `getMkBySiteId`:

```
1. getMkBySiteId(siteId)       → name, faction, knsId, email
2. fetchMkActivity(knsId, 10)  → activity[]
3. Build Mk record with populated activity[]
4. Append to mks.json
```

The MK card shows real data immediately upon add — no waiting for the next poll.

### Poller — `pollMks()` replacement

```
For each Mk where knesset_site_id is set:
  1. fetchMkActivity(knsId, 10)
  2. Identify new items: activity items whose sourceUrl is not in mk.activity[]
  3. If new items: prepend to activity[], trim to 20 total, set hasNewData = true
  4. Update lastPolledAt
  5. Write mks.json only if changed
```

Change detection key: `sourceUrl` encodes the BillID or QueryID uniquely. Both bill and question items always have a `sourceUrl` set at construction time (bills use the Knesset bill page URL, questions use the OData entity URL with their QueryID).

Errors are caught per-MK; one failing MK doesn't stop the others.

### `mks.json` — initial state

Remove hand-crafted activity items. Keep the MK records with `activity: []`. The scraper fills them on first poll or manual refresh.

```json
[
  {
    "id": 1,
    "oknesset_id": "30839",
    "knesset_site_id": "1116",
    "name": "דן אילוז",
    "party": "הליכוד",
    "email": "hak_diluz@knesset.gov.il",
    "photoUrl": "https://main.knesset.gov.il/mk/members/1116/photo",
    "currentRoles": [
      { "positionId": 54, "description": "חבר כנסת", "factionName": "הליכוד", "isCurrent": true, "startDate": "2023-01-06T00:00:00" }
    ],
    "activity": [],
    "recentVotes": [],
    "votingSummary": null,
    "sourceUrl": "https://main.knesset.gov.il/mk/Apps/mk/mk-positions/1116",
    "hasNewData": false,
    "lastPolledAt": null
  },
  {
    "id": 2,
    "oknesset_id": "30870",
    "knesset_site_id": "1117",
    "name": "משה רוט",
    "party": "יהדות התורה",
    "email": null,
    "photoUrl": "https://main.knesset.gov.il/mk/members/1117/photo",
    "currentRoles": [
      { "positionId": 54, "description": "חבר כנסת", "factionName": "יהדות התורה", "isCurrent": false, "startDate": null }
    ],
    "activity": [],
    "recentVotes": [],
    "votingSummary": null,
    "sourceUrl": "https://main.knesset.gov.il/mk/Apps/mk/mk-positions/1117",
    "hasNewData": false,
    "lastPolledAt": null
  }
]
```

---

## Error Handling

- `fetchMkBills` or `fetchMkQuestions` failure: caught individually via `Promise.allSettled`; the working source still contributes results
- Empty results from either endpoint: return `[]` — not an error
- Knesset OData unreachable: tracking route returns 500 with Hebrew error message; poller logs and skips the MK

---

## Files Changed

| File | Change |
|------|--------|
| `server/services/knesset-scraper.ts` | **New** — standalone activity fetcher |
| `server/services/poller.ts` | Replace `pollMks()` with Knesset OData version |
| `server/routes/tracking.ts` | Call `fetchMkActivity` after `getMkBySiteId` on add |
| `src/types.ts` | Add `'question'` to `MkActivityType` |
| `src/data/mks.json` | Remove hand-crafted activity items; keep MK records with `activity: []` |
| `src/components/parliament/MkCard.tsx` | Add question icon + display for `type='question'` |

---

## Testing

1. Start the server (`npm run dev:server`)
2. POST to `/api/tracking/add` with `{"url":"https://main.knesset.gov.il/mk/Apps/mk/mk-positions/1116"}` — response should include `activity[]` with 2024–2026 items, newest first
3. Verify Dan Ilouz has no 2022 bills in the response
4. Verify questions (שאילתות) appear with `type: 'question'`
5. Check `/api/parliament/mk` — returns enriched MK data from `mks.json`
6. Open the drawer in the browser — MkCard shows activity feed with recent bills and questions
