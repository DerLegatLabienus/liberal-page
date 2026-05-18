# Bill & Committee Search Comboboxes — Design Spec

**Date:** 2026-05-18
**Backlog items:** 8 (Bill Combobox), 9 (Committee Combobox)

## Overview

Two parallel features adding searchable comboboxes to the Parliament Drawer. Both live **alongside** the existing `AddTrackingInput` URL-paste (not replacing it — to be removed in a later pass once stable). Both are server-side to avoid CORS issues.

- **Bills (item 8):** 7,369 Knesset 25 bills → type-to-search with 300ms debounce, server-side query
- **Committees (item 9):** ~200 current committees → load-all upfront, client-side fuzzy filter

## Item 8 — Bills

### Backend: `GET /api/bills/search?q=TEXT`

New route file: `server/routes/bills.ts`. Registered in `server/index.ts` at `/api/bills`.

Validation: `q` must be at least 3 characters. Returns 400 otherwise.

Query: `KNS_Bill?$filter=KnessetNum eq 25 and substringof('q', Name)&$top=20&$select=BillID,Name,StatusID&$format=json`

Response per item:
```typescript
interface BillSearchResult {
  billId: number
  name: string
  statusId: number
  knessetUrl: string // https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id={BillID}
}
```

No server-side caching — results are live. The 20-item cap keeps response size small.

### Frontend: `BillSearchCombobox`

**Component:** `src/components/parliament/BillSearchCombobox.tsx`

- Search input with 300ms debounce via `useEffect` + `setTimeout`
- Fires when query ≥ 3 chars; clears results below 3 chars
- Calls `GET /api/bills/search?q=...` via `api.bills.search(q)`
- Loading spinner shown during fetch
- Max 20 results shown in dropdown
- Selecting a result calls `api.tracking.add({ url: result.knessetUrl })` then `onAdd()`
- Closes dropdown after selection

**Placement:** Bills tab in `ParliamentDrawer`, above the existing `AddTrackingInput`.

### `Bill` type update

Add optional field to `src/types.ts`:
```typescript
knessetUrl?: string  // link to official Knesset record when available
```

`BillCard` renders a link when `knessetUrl` is present.

### `api-client.ts` addition
```typescript
bills: {
  search: (q: string) => apiFetch<BillSearchResult[]>(`/bills/search?q=${encodeURIComponent(q)}`),
}
```

## Item 9 — Committees

### Backend: `GET /api/committees/list`

New route file: `server/routes/committees.ts`. Registered at `/api/committees`.

Fetches `KNS_Committee?$filter=IsCurrent eq true` using `odataFetchAll` (follows `odata.nextLink`, same as MK list). Returns ~200 items.

Response per item:
```typescript
interface CommitteeListItem {
  committeeId: number
  name: string
  knessetUrl: string // https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid={CommitteeID}
}
```

File-cached daily via `CommitteeListRepository` (`server/repositories/committee-list-repository.ts`), backed by `src/data/knesset-committees-cache.json` (gitignored). Same structure as `MkListRepository`.

### Frontend: `useCommitteeList` + `CommitteeCombobox`

**`useCommitteeList()`** (`src/hooks/useCommitteeList.ts`): mirrors `useMkList` exactly — module-level session cache, fetches on first call. Returns `{ committees, loading, error }`.

**`CommitteeCombobox`** (`src/components/parliament/CommitteeCombobox.tsx`): mirrors `MkCombobox` — load-all, fuzzy filter by name client-side (no debounce needed), outside-click closes dropdown. Selecting calls `api.tracking.add({ url: item.knessetUrl })` then `onAdd()`.

**`api-client.ts` addition:**
```typescript
committees: {
  list: () => apiFetch<CommitteeListItem[]>('/committees/list'),
}
```

**Placement:** Committees tab in `ParliamentDrawer`, above the existing `AddTrackingInput`.

## Separation of Concerns

| Concern | Bills | Committees |
|---------|-------|------------|
| Route file | `server/routes/bills.ts` | `server/routes/committees.ts` |
| Repository | none (no caching) | `CommitteeListRepository` |
| Cache file | none | `src/data/knesset-committees-cache.json` |
| Hook | none (debounced inline) | `useCommitteeList` |
| Component | `BillSearchCombobox` | `CommitteeCombobox` |
| Data strategy | server-side search, live | load-all, session cache |

## What Is NOT Changing

- `AddTrackingInput` — stays as-is for now (both comboboxes are additive)
- Existing `Bill` and `Committee` types — only `knessetUrl` field added to `Bill`
- Existing tracking routes — `POST /api/tracking/add` reused for both
- `ParliamentDrawer` props — no new props needed; comboboxes use `onAdd` already passed
