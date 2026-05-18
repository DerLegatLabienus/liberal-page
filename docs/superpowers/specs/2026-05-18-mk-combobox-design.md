# MK Combobox & Liberals Showcase — Design Spec

**Date:** 2026-05-18
**Backlog item:** 5 (MK Selection — Combobox Instead of Link)

## Overview

Two related features sharing the same data pipeline:

1. **Drawer MKs tab** — a searchable combobox listing all ~120 Knesset 25 members. Selecting an MK loads their activity card live (single fetch, session-cached). No fetches until explicit selection.
2. **Main page Liberals Showcase section** — shows MkActivityCards for all MKs annotated as `isLiberal` or `isSupporter`. Loads async on mount with per-card spinners. Hidden entirely when no annotations are defined.

## Section 1 — Backend: `GET /api/parliament/mks/list`

New Express route in `server/routes/mks.ts`.

**Fetch:** Queries the Knesset OData API (`KNS_PersonToPosition`) for all members of Knesset 25 with the MK position. Uses paginated requests (follows `@odata.nextLink` or offset/top) until all ~120 members are collected — no partial lists.

**Merge:** Reads `MkAnnotationsRepository.getAll()` and merges `isLiberal`/`isSupporter` flags into each MK entry.

**Cache:** Writes result to `MkListRepository`. On subsequent requests, returns cached list if age < 24 hours; otherwise re-fetches.

**Response shape (per MK):**
```typescript
interface KnessetMember {
  siteId: number        // knesset_site_id — used for GetParlamentayActivity
  name: string
  party: string
  photoUrl: string | null
  isLiberal: boolean
  isSupporter: boolean
}
```

## Section 2 — Repository Layer

Two repository classes, file-backed now, database-ready by design.

**`MkListRepository`** (`server/repositories/mk-list-repository.ts`)
- `get(): KnessetMember[] | null` — returns cached list or null if absent/stale
- `set(list: KnessetMember[]): void` — writes cache with timestamp
- `getAgeMs(): number` — milliseconds since last write
- Backed by: `src/data/knesset-members-cache.json`

**`MkAnnotationsRepository`** (`server/repositories/mk-annotations-repository.ts`)
- `getAll(): Record<string, { isLiberal: boolean; isSupporter: boolean }>` — keyed by siteId string
- `set(siteId: string, annotation: { isLiberal: boolean; isSupporter: boolean }): void`
- Backed by: `src/data/mk-annotations.json`

Both repositories are the single touch-point for database migration (backlog item 2). Routes and services never access the JSON files directly.

## Section 3 — Frontend Hooks

**`useMkList()`** (`src/hooks/useMkList.ts`)
- On first call, fetches `GET /api/parliament/mks/list`
- Stores result in module-level React state — lives for the session, cleared on page reload
- Returns `{ mks: KnessetMember[], loading: boolean, error: string | null }`

**`useMkActivity(siteId: number | null)`** (`src/hooks/useMkActivity.ts`)
- Only fires when `siteId` is non-null
- Fetches `GetParlamentayActivity` via the existing `fetchMkActivity` service (client-side via `/api/parliament/mk-activity?siteId=`)
- Caches results in a module-level `Map<number, MkActivity[]>` — session lifetime
- Returns `{ activity: MkActivity[] | null, loading: boolean, error: string | null }`

## Section 4 — Components

**`MkCombobox`** (`src/components/parliament/MkCombobox.tsx`)
- Accepts: `onSelect: (siteId: number) => void`, `selectedSiteId: number | null`
- Uses `useMkList()` to populate the list
- Search input: fuzzy-filters by name and party (`toLowerCase().includes()` — no external library needed)
- Dropdown items show: small photo (22px circle), name, party, badge if `isLiberal` (💙 blue pill) or `isSupporter` (⭐ amber pill)
- Liberals and supporters sorted to top; rest alphabetical by name
- Accessible: keyboard navigable, `role="combobox"`, `role="listbox"` on dropdown

**`MkActivityCard`** (`src/components/parliament/MkActivityCard.tsx`)
- Accepts: `member: KnessetMember`
- Calls `useMkActivity(member.siteId)`
- While loading: renders MK header (name/photo/party) with a spinner in place of the activity feed
- When loaded: passes full `MkActivity[]` to `MkCard` via props
- On error: shows inline error with retry button

**`LiberalsShowcase`** (`src/components/sections/LiberalsShowcase.tsx`)
- Uses `useMkList()` — filters to `isLiberal || isSupporter`
- Returns `null` when filtered list is empty (section fully hidden)
- Renders a responsive grid of `MkActivityCard` components, all loading in parallel on mount
- Placed on the main page between About and Gallery sections
- Has a section heading (`showcase.heading`)

**Drawer MKs tab update** (`ParliamentDrawer.tsx`)
- Replace tracked MkCard stack with: `MkCombobox` at top + `MkActivityCard` for selected MK below
- `selectedSiteId` in local drawer state
- No MK selected: show `showcase.no_selection` prompt
- Existing tracked MKs stack is removed; combobox is now primary navigation

## Section 5 — New Backend Route: `GET /api/parliament/mk-activity`

Thin proxy route so the frontend can call `fetchMkActivity` without CORS issues.

- `GET /api/parliament/mk-activity?siteId=1116`
- Calls existing `fetchMkActivity(siteId, 10)` from `knesset-scraper.ts`
- Returns `MkActivity[]`
- No caching server-side (client caches via `useMkActivity`)

## Section 6 — Data Files

**`src/data/knesset-members-cache.json`**
- Written by `MkListRepository`; structure: `{ "cachedAt": "ISO string", "members": KnessetMember[] }`
- Add to `.gitignore` (auto-generated)

**`src/data/mk-annotations.json`**
- Manually managed; structure: `{ "1116": { "isLiberal": true, "isSupporter": false }, ... }`
- Seeded with Dan Ilouz (1116) and Moshe Rot (1117) as `isLiberal: true`
- Source-controlled

## Section 7 — i18n Keys

Add to both `he.json` and `en.json`:

```json
"showcase": {
  "heading": "ח\"כים ליברלים בליכוד",
  "supporter_badge": "תומך",
  "liberal_badge": "ליברל בליכוד",
  "search_placeholder": "חפש ח\"כ...",
  "no_selection": "חפש ובחר ח\"כ למעלה"
}
```

English values: `"Liberals in Likud MKs"`, `"Supporter"`, `"Liberal"`, `"Search MK..."`, `"Search and select an MK above"`

## Section 8 — What Is NOT Changing

- `fetchMkActivity` service in `knesset-scraper.ts` — reused as-is
- `MkCard` component — unchanged, receives `mk` prop with activity array
- Polling infrastructure (`poller.ts`) — continues running for tracked MKs
- `AddTrackingInput` — MK URL-paste entry removed; bill/committee tracking unchanged
