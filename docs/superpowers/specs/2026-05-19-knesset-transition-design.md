# Knesset Transition Handling — Design Spec

**Date:** 2026-05-19
**Backlog item:** 11 (Knesset Transition — Handle Dispersal and New Knesset Election)

## Overview

The server currently hardcodes `CURRENT_KNESSET = 25` in 4 places. When the 26th Knesset is elected, these values silently produce stale data. This spec defines auto-detection on startup, a full transition procedure, and an admin trigger endpoint.

## Section 1 — Config File & Service

**`src/data/knesset-config.json`** (source-controlled):
```json
{ "currentKnesset": 25, "detectedAt": "2022-11-01T00:00:00.000Z" }
```

**`server/services/knesset-config.ts`** exports:

- `getCurrentKnesset(): number` — synchronously reads `knesset-config.json` and returns `currentKnesset`. All 4 hardcoded `CURRENT_KNESSET = 25` references replaced with this call:
  - `server/services/knesset-scraper.ts`
  - `server/routes/bills.ts`
  - `server/routes/committees.ts`
  - `server/services/knesset-members.ts` (passed as argument, currently ignored)

- `detectKnessetTransition(): Promise<boolean>` — queries Knesset OData:
  ```
  KNS_PersonToPosition?$filter=PositionID eq 43 and IsCurrent eq true
    &$orderby=KnessetNum desc&$top=1&$select=KnessetNum
  ```
  If the live `KnessetNum` > stored `currentKnesset`, calls `runTransition(liveNum)` and returns `true`. Returns `false` if no change. Called once from `server/index.ts` at startup (non-blocking — awaited but errors caught so server starts regardless).

## Section 2 — Transition Procedure

`runTransition(newKnesset: number)` in `server/services/knesset-config.ts`:

1. **Update config** — writes `{ currentKnesset: newKnesset, detectedAt: new Date().toISOString() }` to `knesset-config.json`
2. **Clear caches** — deletes `src/data/knesset-members-cache.json` and `src/data/knesset-committees-cache.json` (they regenerate automatically on next request with the new Knesset number)
3. **Mark inactive MKs** — reads `src/data/mks.json`, fetches `KNS_Person?$filter=IsCurrent eq true` from OData to get the list of current MK PersonIDs, then cross-references via `KNS_MkSiteCode` to get active SiteIds. Any tracked MK whose `knesset_site_id` is NOT in the active SiteId list gets `inactive: true` written back to `mks.json`.
4. **Log** — `console.log(\`Knesset transition: ${current} → ${newKnesset}\`)`

## Section 3 — Mk Type, Poller, MkCard

**`src/types.ts`**: add `inactive?: boolean` to the `Mk` interface.

**`server/services/poller.ts`**: in `pollMks()`, skip MKs where `mk.inactive === true` (same guard as `!mk.knesset_site_id`).

**`src/components/parliament/MkCard.tsx`**: when `mk.inactive` is true:
- Apply `opacity-60` to the card's left-border color strip
- Render a grey banner inside the card: `"לא חבר/ת כנסת פעיל/ה"` with a muted style, below the MK header and above the activity feed

## Section 4 — Admin Endpoint

**`POST /api/knesset/transition`** — new route in `server/routes/knesset.ts`, registered at `/api/knesset`.

- No body required — runs `detectKnessetTransition()` immediately (re-queries OData and compares)
- Optional query param `?force=26` — bypasses OData check, calls `runTransition(26)` directly (for when election result is confirmed but OData hasn't updated yet)
- Response: `{ transitioned: boolean, from: number, to: number }`
- Returns 500 on OData failure

## Section 5 — What Is NOT Changing

- Tracked committees are not marked inactive — the committee list cache is cleared, so they get refreshed with current data on next `/api/committees/list` call
- Bills and protocols are not touched — they carry their own historical Knesset context
- No UI admin panel — endpoint is curl/API-accessible only
- `knesset-members-cache.json` and `knesset-committees-cache.json` remain gitignored
