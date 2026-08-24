---
name: data-pipeline
description: Background data pipeline — poller, committee-session enricher, summarizer, and the Postgres repository layer. Use for work on polling logic, backoff behavior, session enrichment, PDF/DOCX summarization, alert digests, or storage reclamation.
tools: Read, Edit, Write, Bash, Glob, Grep
model: sonnet
color: green
---

You are working on the **background data pipeline** of the liberal-page project. This subsystem runs independently of the request/response cycle and writes to **Postgres via `server/repositories/`**.

> **There is no runtime JSON datastore.** `src/data/*.json` is static content + read-only config
> only. The poller never writes files. (This brief previously described a JSON-file pipeline; that
> was true before the Phase 1/2 Postgres migration — see `docs/architecture.md`.)

## Scope

- `server/services/poller.ts` — main poll loop (bills + committees + MKs in parallel)
- `server/services/committee-session-enricher.ts` — fetches OData sessions, attaches `attendingSiteIds`
- `server/services/summarizer.ts` — downloads PDF/DOCX, calls Claude API, caches by MD5
- `server/services/storage-manager.ts` — `relieveStoragePressureIfNeeded`, the cheapest-first reclaimer pipeline
- `server/services/email-delivery-poll.ts` — pulls Resend delivery status for in-flight `sent_emails` rows
- `server/repositories/mk-list-repository.ts` — `knesset_members_cache` table, TTL via `getAgeMs()`
- `server/repositories/committee-list-repository.ts` — `knesset_committees_cache` table
- `server/repositories/mk-annotations-repository.ts` — `mk_annotations` table (read-mostly)
- `server/repositories/summaries-repository.ts` — `summaries_cache` table, keyed by document MD5
- Tables written by the pipeline: `bills`, `committees` (+ `committee_sessions`), `mks` (+ its child tables), `summaries_cache`

## Polling lifecycle

- `startPoller()` is called from `server/index.ts` on listen — one instance per server process
- Loop uses `setTimeout` (not `setInterval`) so each cycle's delay is calculated after the previous one completes
- `runPollCycle()` runs bills, committees, and MKs with `Promise.allSettled` — partial failure is tolerated
- **Backoff**: on total failure, delay starts at 1 min and doubles each cycle up to 10 min; a successful cycle resets to `POLL_INTERVAL_MS` (default 6 h, controlled by env var)
- After the entity polls, each cycle also runs three **isolated** steps — `sendBillAlerts` (per-member digests), `relieveStoragePressureIfNeeded` (orphan/ledger reclamation), and `pollDeliveryStatus` (Resend delivery lifecycle). Each is wrapped in try/catch so a failure there never fails the poll cycle.

## Key invariants

- **All writes go through repositories** — never write files, and never hand-roll SQL in a service
- `hasNewData: true` is set by the poller when new status/sessions/activity arrive; it is **not cleared** when the frontend opens the drawer (known limitation, tracked in backlog)
- Summarizer caches by MD5 of the document URL — same URL always returns the cached result; no re-summarization
- `committee-session-enricher` is called at track time and by the poller; it enriches `recentSessions` with `attendingSiteIds` from OData
- Repositories hold in-memory `cachedAt` timestamps; `getAgeMs()` lets callers decide whether to refresh

## Backend layer specialties

- Express 5 + `tsx` runtime — no TypeScript compile step; types are checked separately with `npx tsc --noEmit`
- All route files use `express.Router()` and are mounted in `server/index.ts`
- Shared types live in `src/types.ts` — never duplicate them in server files
- CORS allowed origins: `CORS_ORIGIN` env var (comma-separated); defaults to `http://localhost:5173`
- `async/await` throughout; `Promise.allSettled` for parallel work where partial success is valid

## Tests (node environment)

- Test files live under `tests/server/knesset/` (nested by feature, not flat): `poller.test.ts`, `poller-alerts.test.ts`, `summarizer.test.ts`, `committee-session-enricher.test.ts`, `mk-list-repository.test.ts`
- Environment is `node` — no DOM APIs
- **Do not mock `fs/promises`** — there are no JSON files to protect. Tests run against a real in-memory **pglite** Postgres via `tests/server/db-harness.ts` (`setupTestDb()`), so repository behavior is exercised for real
- Mock `fetch` for external calls: `vi.spyOn(global, 'fetch')`
- Run a single file: `npx vitest run tests/server/knesset/poller.test.ts`
