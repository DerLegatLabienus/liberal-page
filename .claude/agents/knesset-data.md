---
name: knesset-data
description: External Knesset API layer — three different APIs (oknesset REST, Knesset OData, Knesset website scraper), ID mapping between SiteId/KnsID, and on-disk repository caches. Use for any work touching external data fetching, adding new data fields from the Knesset, or debugging API responses.
tools: Read, Edit, Write, Bash, Glob, Grep
model: sonnet
color: yellow
---

You are working on the **external Knesset data layer** of the liberal-page project. This layer has three distinct APIs with incompatible ID schemes and one bot-protected endpoint.

## Scope

- `server/services/knesset-api.ts` — Knesset OData client (`knesset.gov.il/Odata/ParliamentInfo.svc`)
- `server/services/oknesset.ts` — oknesset.org REST client (bill status, committee sessions)
- `server/services/knesset-members.ts` — fetches and assembles KnessetMember list
- `server/services/knesset-scraper.ts` — scrapes `GetParlamentayActivity` for MK activity feed
- `server/services/knesset-config.ts` — detects Knesset transitions; marks MKs inactive
- `server/repositories/mk-list-repository.ts` — cache for KnessetMember list (6 h TTL)
- `server/repositories/committee-list-repository.ts` — cache for committee list
- `server/repositories/mk-annotations-repository.ts` — `mk-annotations.json` (isLiberal/isSupporter flags)
- `src/data/knesset-config.json` — current Knesset number and active SiteIds

## The three APIs

| API | Base | Used for | Identifier |
|-----|------|----------|------------|
| **oknesset.org** | `https://oknesset.org/api/v2` | Bill status, committee sessions | `oknesset_id` (string) |
| **Knesset OData** | `knesset.gov.il/Odata/ParliamentInfo.svc` | Member identity, bill/committee lookup | Internal `KnsID` (PersonID) |
| **Knesset website** | `knesset.gov.il/WebSiteData` | MK activity feed (`GetParlamentayActivity`) | `knesset_site_id` (integer, e.g. 1116) |

## ID mapping

- Knesset **URLs** use `SiteId` (e.g. `/mk/Apps/mk/mk-positions/1116`)
- Knesset **OData** uses internal `KnsID` (PersonID)
- Join table: `KNS_MkSiteCode` — query with `$filter=SiteId eq 1116` to get `KnsID`
- `knesset_site_id` on the `Mk` type is the integer SiteId used by the scraper
- `oknesset_id` is a separate string ID used only for oknesset.org REST calls

## Key invariants

- Main `knesset.gov.il` is bot-protected — only `GetParlamentayActivity` is scraped; do not attempt to scrape other pages
- Always read through repositories (not direct file reads) — they handle TTL and cache refresh
- `mk-annotations.json` holds `isLiberal`/`isSupporter` — these are editorial flags, NOT from any API
- `knesset-config.json` lists active SiteIds for the current Knesset; `knesset-config.ts` uses it to mark MKs inactive on transition

## Tests (node environment)

- Test files: `tests/server/knesset-*.test.ts`, `tests/server/oknesset.test.ts`, `tests/server/knesset-scraper.test.ts`
- Environment is `node` — no DOM APIs available
- Mock `fetch` with `vi.spyOn(global, 'fetch')` or `vi.fn()`
- Mock repository file reads via `vi.mock('fs/promises')`
- Run a single file: `npx vitest run tests/server/knesset-members.test.ts`
