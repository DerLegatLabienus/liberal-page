# Backend OData Centralization — Implementation Plan (Item 4)

> Execute task-by-task with TDD. Existing service/route tests (they mock `global.fetch`)
> are the regression guard — they must stay green after each migration.

**Goal:** One shared `server/services/odata.ts` owning base URL + headers + errors; no
direct OData `fetch` in route handlers; all 8 duplicated-`ODATA_BASE` sites routed through
the helper. No behavior/response/HTML changes.

---

### Task 1: `server/services/odata.ts` + tests (TDD)
- `odataGet<T>(pathAndQuery, opts?)`: `fetch(`${ODATA_BASE}/${path}`, {headers:{Accept,..opts.headers}})`;
  throw on non-OK (msg includes path; `opts.errorContext` prefix); lenient parse
  `data.value ?? (Array.isArray(data) ? data : [data])`; pass `opts.signal`.
- `odataGetAllPages<T>`: follow `'odata.nextLink'` until exhausted, concatenating.
- `tests/server/odata.test.ts` (mock fetch): URL composition; default+merged headers;
  throw-with-context on non-OK; lenient parse (`{value}`, bare array, single object);
  pagination across `nextLink`.

### Task 2: Migrate simple single-page call sites onto `odataGet`
Behavior-preserving. Run each site's existing test after.
- `knesset-api.ts`: replace local `odata<T>` with `odataGet(path, { errorContext: 'Knesset OData' })`; drop `BASE`.
- `knesset-bills.ts`: `cachedQuery` + `fetchBillsByIds` use `odataGet`; drop `ODATA_BASE`.
- `bill-status-map.ts`: wrap `odataGet` in the existing try→`new Map()` (swallow preserved); drop `ODATA_BASE`.
- `committee-session-enricher.ts`: replace local error-swallowing `odataGet` with a thin
  `safeOdataGet` = `try { return await odataGet(p) } catch { return [] }`; drop `ODATA_BASE`.
- `knesset-config.ts` `detectKnessetTransition`: `odataGet` inside its existing try→false; drop `ODATA_BASE`.

### Task 3: Migrate paginated call sites onto `odataGetAllPages`
- `knesset-members.ts`: `odataFetch`→`odataGet`, `odataFetchAll`→`odataGetAllPages`; drop `ODATA_BASE`.
- `committee-list-refresh.ts`: drop local `odataFetchAll` + `ODATA_BASE`; use `odataGetAllPages`.

### Task 4: Bill search → service (remove route fetch)
- Add `searchBills(query, knesset): Promise<BillSearchResult[]>` to `knesset-bills.ts`
  (OData query + `knessetUrl` shaping moved in; uses `odataGet`).
- `bills.ts /search`: keep `q.length<3` 400 + `res.json(await searchBills(q, getCurrentKnesset()))`; drop `ODATA_BASE`.
- New `searchBills` test; `bills-route.test.ts` stays green.

### Task 5: Committee detail → service (remove route fetch)
- New `server/services/knesset-committees.ts`: `fetchCommitteeDetail(committeeId)` →
  `{ committee, sessions } | null` (two `odataGet` calls; `null` when committee missing).
- `committees.ts /info`: call service, 404 on `null`, else render the **existing HTML** unchanged; drop `ODATA_BASE`.
- New `fetchCommitteeDetail` test; `committees-route.test.ts` stays green.

### Verify
- `grep -rn "ParliamentInfo.svc" server/` → only `server/services/odata.ts`.
- No OData `fetch(` in `server/routes/`.
- `npx tsc --noEmit` clean; `npm test` green; `npm run lint` no new errors.
