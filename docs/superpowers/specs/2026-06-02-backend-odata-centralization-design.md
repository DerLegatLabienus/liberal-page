# Backend OData Centralization (Backlog Item 4)

**Date:** 2026-06-02
**Status:** Approved — ready for implementation plan
**Scope:** Backend only. The frontend already satisfies item 4 (single `src/lib/api-client.ts`, no raw `fetch` in components).

## Problem

Backlog item 4 requires that API calls go through a dedicated layer, with a single
place for base URLs, headers, and error handling, and that **route handlers call
services only — no direct Knesset API calls in handlers**.

Two violations remain on the backend:

- `server/routes/bills.ts` (`GET /search`) builds a Knesset OData URL and `fetch`es it inline.
- `server/routes/committees.ts` (`GET /info/:committeeId`) makes two inline OData `fetch`es.

Separately, the OData base URL is duplicated across **8 files** and the
`fetch(..., { headers: { Accept: 'application/json' } })` pattern is repeated in most
of them — so the "single source for base URL/headers/errors" goal is unmet on the
service layer too.

Duplicated `ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'` in:
routes `bills.ts`, `committees.ts`; services `knesset-bills.ts`, `knesset-api.ts`
(as `BASE`), `bill-status-map.ts`, `committee-list-refresh.ts`,
`committee-session-enricher.ts`, `knesset-members.ts`, `knesset-config.ts`.

## Goal

- No direct external API calls in route handlers.
- One shared OData access point owning base URL, headers, and error handling.
- All 8 call sites route through it; zero duplicated `ODATA_BASE`; no behavior loss.

## Design

### 1. New shared module — `server/services/odata.ts`

```ts
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

interface OdataOptions {
  headers?: Record<string, string>   // merged over the default { Accept: 'application/json' }
  errorContext?: string              // prefixes the thrown error, e.g. 'Knesset OData'
  signal?: AbortSignal               // timeout / cancellation
}

// Single page: throws on non-OK, returns the result array.
export async function odataGet<T>(pathAndQuery: string, opts?: OdataOptions): Promise<T[]>

// All pages: follows the `odata.nextLink` key until exhausted, concatenating results.
export async function odataGetAllPages<T>(pathAndQuery: string, opts?: OdataOptions): Promise<T[]>
```

Behavior:

- Composes `${ODATA_BASE}/${pathAndQuery}`. Callers pass only entity + query
  (e.g. `KNS_Bill?$filter=...`); they never reference the base URL or headers.
- Default header `{ Accept: 'application/json' }`; `opts.headers` merge over it.
- **Error**: throws on non-OK and always includes the path. When `opts.errorContext`
  is given it prefixes the message (e.g. `Knesset OData error 500: KNS_Bill?...`),
  preserving `knesset-api.ts`'s existing message shape.
- **Parsing (lenient default)**: `data.value ?? (Array.isArray(data) ? data : [data])`
  — tolerates `{ value: [...] }`, a bare array, or a single object. This matches
  `knesset-api.ts`'s current tolerant parser so it can adopt the helper unchanged.
- `odataGetAllPages` follows the `'odata.nextLink'` key (OData v3 style; relative
  path like `KNS_Person?...&$skiptoken=N`), concatenating each page's results until
  no `nextLink` remains.

### 2. Move the two route calls into services

**Bill search** — add to `server/services/knesset-bills.ts`:

```ts
export async function searchBills(query: string, knesset: number): Promise<BillSearchResult[]>
```

The OData query **and** the result shaping (the `knessetUrl` construction) move into
the service. `server/routes/bills.ts` keeps only the `q.length < 3` validation and
`res.json(results)`; on service error its existing `catch` returns 500.

**Committee detail** — new `server/services/knesset-committees.ts`:

```ts
export async function fetchCommitteeDetail(committeeId: number):
  Promise<{ committee: CommitteeInfo; sessions: CommitteeSessionRow[] } | null>
```

Returns `null` when the committee is not found. The two OData fetches move here.
**The HTML rendering stays in `server/routes/committees.ts`** — that is HTTP
presentation, not an API call. The route calls the service, returns 404 on `null`,
otherwise renders the existing HTML.

### 3. Migrate the remaining call sites onto the helper

| File | Helper |
|---|---|
| `knesset-bills.ts` (incl. new `searchBills`) | `odataGet` |
| `knesset-committees.ts` (new) | `odataGet` |
| `bill-status-map.ts` | `odataGet` |
| `committee-session-enricher.ts` | `odataGet` |
| `knesset-config.ts` | `odataGet` |
| `knesset-api.ts` | `odataGet(path, { errorContext: 'Knesset OData' })` |
| `knesset-members.ts` | `odataGetAllPages` |
| `committee-list-refresh.ts` | `odataGetAllPages` |

`knesset-api.ts`'s internal `odata<T>` wrapper is removed in favor of the shared
helper. `knesset-members.ts` and `committee-list-refresh.ts` lose their hand-rolled
`nextLink` loops. Result: one `ODATA_BASE`, defined only in `odata.ts`.

### 4. Error handling (behavior preserved)

`odataGet` throwing on non-OK matches `bills.ts` today; route `catch` blocks still
return 500. Minor improvement: `committees.ts` currently calls `.json()` without
checking `.ok`; routing through the helper now fails fast on a bad status (still
caught → 500).

### 5. Testing (TDD)

- New `tests/server/odata.test.ts` (mock `fetch`):
  - composes base URL + path correctly
  - sends default `Accept` header; `opts.headers` merge over it
  - throws on non-OK; thrown error includes path and `errorContext` prefix
  - lenient parsing: `{ value }`, bare array, and single object
  - `odataGetAllPages` follows `odata.nextLink` across pages
- New focused tests for `searchBills` (query → `BillSearchResult[]`, including
  `knessetUrl` shaping) and `fetchCommitteeDetail` (found vs `null`).
- Existing `tests/server/bills-route.test.ts` and `tests/server/committees-route.test.ts`
  must stay green — behavior is unchanged; they are the regression guard.

## Non-goals

- No frontend changes (already centralized).
- No change to OData query semantics, response shapes, or HTML output.
- No new dependencies.
