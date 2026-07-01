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
npm run db:up            # start local Postgres (Docker)
npm run db:down          # stop local Postgres
npm run db:reset         # wipe volume and start fresh (ephemeral)
```

### Local database

The server connects to whatever `DATABASE_URL` points at — a local Docker
Postgres (default) or Neon. One driver (`node-postgres`) serves both; switching
is a one-line `.env` edit. Tests use in-memory pglite and need no database.

Setup: copy `.env.example` → `.env`.

- `npm run db:up`     start local Postgres (Docker)
- `npm run db:down`   stop it
- `npm run db:reset`  wipe the volume and start fresh (ephemeral)
- `npm run db:seed`   load the JSON baseline as test data (preloaded; pass DATABASE_URL or set it in your shell)

Ephemeral run:  `npm run db:reset` -> `npm run dev`  (empty DB, schema applied on boot).
Preloaded run:  `npm run db:up` -> `npm run dev` -> `npm run db:seed`  (test data, persists until reset).

To use Neon instead, set `DATABASE_URL` to the Neon pooled connection string
(`...-pooler.neon.tech/...?sslmode=require`) in `.env`.

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

`src/data/*.json` is **static content + read-only config only** (about, faq, gallery, site, primaries, protocols, representatives, updates, committee-url-mapping, trending-bills). No tracked parliament data lives here.

The curated parliament baseline (bills, committees, MKs, feature flags, annotations) lives in `scripts/seed-data/` and is loaded via `npm run db:seed`.

All tracking (bills, committees, MKs) is per-user against a single shared account (`users.id = 1`). Routes and the poller read/write Postgres exclusively via `server/repositories/`. The `server/db/` module uses `node-postgres` as the single driver for local Docker and Neon targets, and applies startup migrations automatically.

`DATABASE_URL` must be set to run the server with Postgres or to seed the database (local Docker default: `postgresql://postgres:postgres@localhost:5432/liberal_dev`).

**Deploy ordering:** the backend requires a provisioned Postgres DB. Migrations apply automatically on boot. Run `npm run db:seed` once against the target `DATABASE_URL` BEFORE serving traffic. Serving an unseeded DB results in empty tracked data and all MK liberal/supporter flags defaulting to false.

The single source of truth for all TypeScript shapes is `src/types.ts` — shared by both frontend and `server/`.

### Frontend flow

`App.tsx` owns `useParliament()` state and passes it down. `useParliament` initialises with empty state, then immediately refreshes from the API on mount (no static JSON imports for tracked data).

The site is **Hebrew-first**. Language is detected via `?lang=` query param or `localStorage`, then stored in `document.documentElement.lang/dir`. The parliamentary tracker and several sections only render when `i18n.language === 'he'`. Direction-sensitive components use `useDirection()`, which reads `document.documentElement.dir`.

### Backend API

| Method   | Path                          | Notes |
|----------|-------------------------------|-------|
| `GET`    | `/api/health`                 | health check |
| `GET`    | `/api/parliament/:type`       | reads tracked entities from DB, returns data |
| `POST`   | `/api/tracking/add`           | parse URL → fetch metadata → upsert entity + tracking row in DB |
| `DELETE` | `/api/tracking/:type/:id`     | remove tracking row from DB by entity `id` |
| `POST`   | `/api/summarize`              | **requireAuth + per-IP rate limit.** SSRF-guarded download (host allowlist + IP check) → Claude (relevance-gated) → cache in DB (summaries_cache) |
| `GET`    | `/api/bills/search`           | search Knesset OData API |
| `POST`   | `/api/bills/track`            | add bill by Knesset bill ID |
| `GET`    | `/api/bills/recent`           | Bills Overview Recent tab (ordered by BillID desc or progress date) |
| `GET`    | `/api/bills/trending`         | Bills Overview Trending tab (curated list hydrated from OData) |
| `GET`    | `/api/bills/policy-aligned`   | Bills Overview Policy tab (keyword filter; hidden when flag off) |
| `GET`    | `/api/committees/list`        | list committees from Knesset API |
| `POST`   | `/api/committees/track`       | add committee by Knesset committee ID |
| `GET`    | `/api/committees/info/:id`    | fetch committee detail from Knesset OData |
| `GET`    | `/api/mks/list`               | list all Knesset members (cached 6 h) |
| `GET`    | `/api/mks/activity`           | fetch MK activity by `siteId` |
| `GET`    | `/api/feature-flags`          | all feature flags for the frontend |
| `POST`   | `/api/analytics/join`         | fire-and-forget join click-through event |
| `POST`   | `/api/auth/google`            | exchange Google ID token for access + refresh tokens |
| `POST`   | `/api/auth/refresh`           | refresh access token |
| `POST`   | `/api/auth/logout`            | revoke refresh token |
| `GET`    | `/api/auth/me`                | current user profile (requireAuth) |
| `PATCH`  | `/api/auth/me`                | update display name (requireAuth) |
| `POST`   | `/api/meetings/booking-link`  | **Public.** Verify Google identity, check Calendly for active booking, return single-use link |
| `POST`   | `/api/knesset/transition`     | trigger Knesset transition (bump current number, re-stamp MK terms) |
| `GET`    | `/api/admin/invites`          | list allowlist emails (admin) |
| `POST`   | `/api/admin/invites`          | add allowlist email + send invitation (admin) |
| `DELETE` | `/api/admin/invites/:email`   | remove allowlist email (admin) |
| `GET`    | `/api/admin/users`            | list all users (admin) |
| `PATCH`  | `/api/admin/users/:id/role`   | update user role (admin) |
| `GET`    | `/api/admin/email-templates`  | list email templates (admin) |
| `PUT`    | `/api/admin/email-templates/:name` | update email template (admin) |
| `PUT`    | `/api/admin/feature-flags/:name`   | update feature flag enabled/value (admin) |
| `GET`    | `/api/admin/analytics/join`        | join click-through summary: lifetime + daily rows (admin) |
| `POST`   | `/api/admin/letters/beautify`      | AI clean+improve letter body HTML (admin; gated by `lettersBeautifyEnabled` flag → 404 when off). Output is sanitized. |
| `GET`    | `/api/admin/letters/media`         | list R2-hosted letter image assets (admin; 503 when R2 unconfigured) |
| `POST`   | `/api/admin/letters/media`         | upload raster image to R2 (admin; byte-sniff raster-only + 5 MB; 503 when R2 unconfigured) |
| `DELETE` | `/api/admin/letters/media/:id`     | delete image from R2 + DB (admin; 503 when R2 unconfigured) |
| `GET`    | `/api/letters/contacts`            | **requireAuth + `lettersEnabled`.** Read-only address book for the member recipient picker (optional `?q=` search). |

`type` is one of `bill`, `committee`, or `mk`.

The mailto/Gmail compose-URL builders live in `src/lib/letter-urls.ts` (pure, no deps) so the
server detail endpoint and the client (member recipient edits) produce identical URLs from one
source; `server/services/letter-utils.ts` re-exports them.

Letter & template HTML written via the letter/template admin routes is sanitized
server-side (`server/services/html-sanitizer.ts`, strict allowlist) before storage,
since it is later opened in a scriptable context (Blob "open in new tab", rich clipboard).

### External data sources

- **oknesset.org REST API** — bill status, committee sessions (used by poller and tracking routes)
- **Knesset OData API** (`knesset.gov.il/Odata/ParliamentInfo.svc`) — member identity, bill/committee lookup for comboboxes. Uses `SiteId` in URLs but internal `KnsID` in the OData layer; `KNS_MkSiteCode` is the join table.
- **Knesset website API** (`GetParlamentayActivity`) — MK activity feed. Identified by `knesset_site_id` (integer, e.g. `1116`).
- **Main knesset.gov.il site** — bot-protected; only scraped for specific activity endpoints.

**SSRF guard:** all server-side document fetches in the summarizer go through
`server/services/url-guard.ts` — a host allowlist (`*.knesset.gov.il`) plus an `ipaddr.js` check
that rejects any resolved non-public address, with redirect re-validation, a timeout, and a size
cap. Extend `ALLOWED_DOC_HOST_SUFFIXES` if a legitimate document host outside `knesset.gov.il` is
ever needed.

### Poller

Started by `server/index.ts` on listen. Default interval: 6 hours (`POLL_INTERVAL_MS`). On total failure, backs off exponentially from 1 min up to 10 min.

Each cycle: polls bills via oknesset, fetches committee sessions and runs `committee-session-enricher`, fetches MK activity via `knesset-scraper`. Sets `hasNewData: true` when new content is detected. All writes go through `BillsRepository`, `CommitteesRepository`, and `MksRepository` — no JSON file writing.

### Repositories and caches

`server/repositories/` covers all data access (all Postgres, no JSON files):
- `BillsRepository`, `CommitteesRepository`, `MksRepository` — entity tables; reads reassemble normalized rows into typed aggregates
- `TrackedBillsRepository`, `TrackedCommitteesRepository`, `TrackedMksRepository` — per-user tracking join tables
- `UsersRepository` — shared account (id=1)
- `MkListRepository` — `knesset_members_cache` table, refreshed on stale reads
- `CommitteeListRepository` — `knesset_committees_cache` table
- `MkAnnotationsRepository` — `mk_annotations` table (liberal/supporter flags)
- `SummariesRepository` — `summaries_cache` table (document summaries keyed by MD5)
- `FeatureFlagsRepository` — `feature_flags` table (flat global flag registry)
- `KnessetConfigRepository` — `knesset_config` table (current Knesset number)

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
