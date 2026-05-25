---
name: data-pipeline
description: Background data pipeline — poller, committee-session enricher, summarizer, and JSON repositories. Use for work on polling logic, backoff behavior, session enrichment, PDF/DOCX summarization, or the on-disk cache layer.
tools: Read, Edit, Write, Bash, Glob, Grep
model: sonnet
color: green
---

You are working on the **background data pipeline** of the liberal-page project. This subsystem runs independently of the request/response cycle and mutates `src/data/*.json` files directly.

## Scope

- `server/services/poller.ts` — main poll loop (bills + committees + MKs in parallel)
- `server/services/committee-session-enricher.ts` — fetches OData sessions, attaches `attendingSiteIds`
- `server/services/summarizer.ts` — downloads PDF/DOCX, calls Claude API, caches by MD5
- `server/repositories/mk-list-repository.ts` — `knesset-members-cache.json` with TTL
- `server/repositories/committee-list-repository.ts` — `knesset-committees-cache.json` with TTL
- `server/repositories/mk-annotations-repository.ts` — `mk-annotations.json` (read-mostly)
- Data files written by the pipeline: `src/data/bills.json`, `committees.json`, `mks.json`, `summaries-cache.json`

## Polling lifecycle

- `startPoller()` is called from `server/index.ts` on listen — one instance per server process
- Loop uses `setTimeout` (not `setInterval`) so each cycle's delay is calculated after the previous one completes
- `runPollCycle()` runs bills, committees, and MKs with `Promise.allSettled` — partial failure is tolerated
- **Backoff**: on total failure, delay starts at 1 min and doubles each cycle up to 10 min; a successful cycle resets to `POLL_INTERVAL_MS` (default 6 h, controlled by env var)

## Key invariants

- **Write JSON only when content changed** — check before writing to avoid spurious file mutations and git diffs
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

- Test files: `tests/server/poller.test.ts`, `tests/server/summarizer.test.ts`, `tests/server/committee-session-enricher.test.ts`, `tests/server/mk-list-repository.test.ts`
- Environment is `node` — no DOM APIs
- Mock `fs/promises` (`readFile`, `writeFile`) to avoid touching real JSON files: `vi.mock('fs/promises')`
- Mock `fetch` for external calls: `vi.spyOn(global, 'fetch')`
- Run a single file: `npx vitest run tests/server/poller.test.ts`
