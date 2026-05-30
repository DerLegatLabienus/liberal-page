# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

- **Frontend:** React 18 + Vite (port 5173)
- **Backend:** Express 5 + `tsx` (port 3001)
- Both live in the same repo. Vite proxies `/api/*` → `localhost:3001`.

## Commands

```bash
npm run dev              # both servers concurrently (Vite + tsx watch)
npm run dev:frontend     # Vite only on :5173
npm run dev:server       # Express only on :3001
npm run lint             # ESLint 9
npx tsc --noEmit         # type check (both app and server tsconfigs)
npm test                 # Vitest run (no servers needed)
npm run build            # tsc -b && vite build
npm run db:generate      # generate a Drizzle migration after schema changes
npm run db:seed          # one-time JSON → DB seed (requires DATABASE_URL)
```

Run a single test file:
```bash
npx vitest run tests/server/poller.test.ts
```

After backend changes, smoke-test the API:
```bash
curl http://localhost:3001/api/health
```

## Restarting

- **Backend (`server/`):** `tsx watch` auto-reloads when using `npm run dev:server`. If started manually, kill and restart.
- **Frontend (`src/`):** Vite hot-reloads automatically. Restart only when config files change (`vite.config.ts`, `tailwind.config.ts`, `index.css`).

When in doubt: `pkill -f "vite|tsx server" && npm run dev`

## Key Ports

| Service  | Port | URL                    |
|----------|------|------------------------|
| Frontend | 5173 | http://localhost:5173  |
| Backend  | 3001 | http://localhost:3001  |

Frontend is accessible from Windows at `http://localhost:5173` (via `host: '0.0.0.0'` in vite.config.ts).

## Architecture

### Data model

`src/data/*.json` is the **frontend static seed** and the baseline for `npm run db:seed`. The files are also read/written directly by the Express routes and poller (the live routing through the Postgres repositories is Phase 2).

Postgres (Neon, via `DATABASE_URL`) stores entity, cache, and config data through `server/repositories/`. The `server/db/` module handles the driver-selecting client and startup migrations.

Key JSON files: `bills.json`, `committees.json`, `mks.json`, `summaries-cache.json`, `knesset-members-cache.json`.

`DATABASE_URL` must be set to a Neon connection string to run the server with Postgres or to seed the database.

The single source of truth for all TypeScript shapes is `src/types.ts` — shared by both frontend and `server/`.

### Frontend flow

`App.tsx` owns `useParliament()` state and passes it down. `useParliament` initialises from static JSON imports, then immediately refreshes from the API on mount.

The site is **Hebrew-first**. Language is detected via `?lang=` query param or `localStorage`, then stored in `document.documentElement.lang/dir`. The parliamentary tracker and several sections only render when `i18n.language === 'he'`. Direction-sensitive components use `useDirection()`, which reads `document.documentElement.dir`.

### Backend API

| Method   | Path                          | Notes |
|----------|-------------------------------|-------|
| `GET`    | `/api/health`                 | health check |
| `GET`    | `/api/parliament/:type`       | reads JSON, may enrich, returns data |
| `POST`   | `/api/tracking/add`           | parse URL → fetch metadata → append to JSON |
| `DELETE` | `/api/tracking/:type/:id`     | remove by local `id` |
| `POST`   | `/api/summarize`              | download PDF/DOCX → Claude → cache |
| `GET`    | `/api/bills/search`           | search Knesset OData API |
| `POST`   | `/api/bills/track`            | add bill by Knesset bill ID |
| `GET`    | `/api/committees/list`        | list committees from Knesset API |
| `POST`   | `/api/committees/track`       | add committee by Knesset committee ID |
| `GET`    | `/api/mks/list`               | list all Knesset members (cached 6 h) |
| `GET`    | `/api/mks/activity`           | fetch MK activity by `siteId` |

`type` is one of `bill`, `committee`, or `mk`.

### External data sources

- **oknesset.org REST API** — bill status, committee sessions (used by poller and tracking routes)
- **Knesset OData API** (`knesset.gov.il/Odata/ParliamentInfo.svc`) — member identity, bill/committee lookup for comboboxes. Uses `SiteId` in URLs but internal `KnsID` in the OData layer; `KNS_MkSiteCode` is the join table.
- **Knesset website API** (`GetParlamentayActivity`) — MK activity feed. Identified by `knesset_site_id` (integer, e.g. `1116`).
- **Main knesset.gov.il site** — bot-protected; only scraped for specific activity endpoints.

### Poller

Started by `server/index.ts` on listen. Default interval: 6 hours (`POLL_INTERVAL_MS`). On total failure, backs off exponentially from 1 min up to 10 min.

Each cycle: polls bills via oknesset, fetches committee sessions and runs `committee-session-enricher`, fetches MK activity via `knesset-scraper`. Sets `hasNewData: true` when new content is detected. Writes the JSON file only when content changed.

### Repositories and caches

`server/repositories/` wraps the on-disk caches with TTL logic:
- `MkListRepository` — `knesset-members-cache.json`, refreshed on stale reads
- `CommitteeListRepository` — `knesset-committees-cache.json`
- `MkAnnotationsRepository` — `mk-annotations.json` (liberal/supporter flags)

### Tests

- `tests/components/` — happy-dom environment, `react-i18next` auto-mocked via `src/__mocks__/react-i18next.ts`
- `tests/server/` — node environment (see `vitest.config.ts` `environmentMatchGlobs`)
- `tests/unit/` — pure logic, happy-dom

## Visual Companion (Brainstorming)

WSL2 is detected as Linux, so the brainstorm server's auto-detection does **not** enable foreground mode. Without `--foreground`, the server dies within seconds.

**Always start with `--foreground` + `run_in_background: true`:**

```bash
bash /path/to/start-server.sh --project-dir /path/to/project --host 0.0.0.0 --url-host localhost --foreground
# Bash tool must use run_in_background: true
```

## Documentation Files

| What changed | File to update |
|---|---|
| Dev workflow, scripts, ports | `CLAUDE.md` |
| Architecture, data flow, API | `docs/architecture.md` |
| UI components — props, responsibilities | `docs/components.md` |
| Data shapes, JSON schema | `docs/data-schema.md` |
| Feature design / requirements | `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md` |
| Implementation plan steps | `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` |
| Backlog items | `BACKLOG.md` — commit immediately after adding |
