# Architecture

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18.3 + TypeScript 5.6 |
| Build/dev server | Vite 5.4 on `http://localhost:5173` |
| Styling | Tailwind CSS + shadcn-style UI primitives in `src/components/ui/` |
| Backend | Express 5 + `tsx`, running on `http://localhost:3001` |
| Data | Postgres via Neon/Docker (entity, tracking, cache, config, feature flags) + `src/data/*.json` for static content only |
| External data | oknesset.org REST API + Knesset OData API |
| Summaries | Anthropic SDK, PDF/DOCX text extraction, MD5 cache |
| Tests | Vitest + Testing Library |
| Linting | ESLint 9 with react-hooks + react-refresh plugins |

## Runtime

Use the combined dev command:

```bash
npm run dev
```

This runs Vite and `tsx watch server/index.ts` concurrently. The Vite dev server proxies `/api/*` to `localhost:3001`.

Separate commands are also available:

```bash
npm run dev:frontend
npm run dev:server
```

Starting the backend also starts the poller. The poller updates Postgres via repositories.

## Folder Structure

```text
liberal-page/
├── src/
│   ├── App.tsx                  # Entry: public page + ParliamentDrawer
│   ├── main.tsx
│   ├── index.css                # Tailwind, shadcn imports, theme tokens, fonts
│   ├── types.ts                 # Shared frontend/server TypeScript interfaces
│   ├── components/
│   │   ├── layout/              # Header, Footer, ParliamentDrawer
│   │   ├── sections/            # Hero, ParliamentStrip, About, Gallery, FAQ, Join
│   │   ├── parliament/          # tracking input and bill/committee/MK cards
│   │   └── ui/                  # shadcn-style primitives
│   ├── hooks/
│   │   ├── useDirection.ts      # reads document.documentElement.dir
│   │   └── useParliament.ts     # fetches /api/parliament/:type
│   ├── lib/
│   │   └── api-client.ts        # typed wrappers around /api routes
│   └── data/                    # JSON datastore and static content
├── server/
│   ├── index.ts                 # Express app, routes, poller startup
│   ├── routes/                  # tracking, parliament, summarize
│   └── services/                # oknesset, Knesset OData, summarizer, poller, URL parser
├── tests/
├── docs/
├── BACKLOG.md
├── package.json
└── vite.config.ts               # alias + /api proxy
```

## Frontend Flow

`App.tsx` renders a single scrolling Hebrew homepage:

```text
Header
main
  HeroSection
  ParliamentStrip
  AboutSection
  GallerySection
  FaqSection
  JoinSection
Footer
ParliamentDrawer
```

The parliamentary drawer opens from the header and parliament strip. It has three tabs: bills, committees, and MKs. The drawer is populated by `useParliament()`, which initialises with empty state and immediately refreshes from the Express API on mount (no static JSON imports for tracked data).

## Backend API

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/health` | Returns server health and timestamp |
| `GET` | `/api/parliament/:type` | Reads tracked entities from DB via `TrackedBills/Committees/MksRepository`, returns data |
| `POST` | `/api/tracking/add` | Parses URL or raw ID, fetches metadata, upserts entity + tracking row in DB |
| `DELETE` | `/api/tracking/:type/:id` | Removes a tracking row from DB by entity `id` |
| `POST` | `/api/summarize` | Downloads a PDF/DOCX, summarizes it, and stores the result via `SummariesRepository` (DB) |
| `GET` | `/api/feature-flags` | Returns all feature flags as a flat map `Record<string, { enabled, value }>` from the DB |
| `POST` | `/api/analytics/join` | Records a Join-section click-through (`{ status, mode }`) via `JoinAnalyticsRepository`. Returns `200 { ok: true }`, `400` on invalid combo. Fire-and-forget from the client; no read endpoint (data is DB-only) |

`type` is one of `bill`, `committee`, or `mk`.

Supported URL parsing currently includes:

- `oknesset.org/bill/<id>`
- `oknesset.org/member/<id>`
- `oknesset.org/committee/<id>`
- Knesset committee URLs with `CommitteeId=<id>`
- Knesset bill URLs with `BillId=<id>`
- Knesset MK URLs under `/mk/Apps/mk/mk-positions/<siteId>` and `/mk/mk-detail/<siteId>`

The UI mentions `gov.il`, but general `gov.il` parsing is not implemented in the current parser.

## OData Access

All Knesset OData calls go through `server/services/odata.ts` — `odataGet` (single page)
and `odataGetAllPages` (follows `odata.nextLink`). It is the single owner of the OData
base URL, default headers, error handling, and response parsing; no other module
references the base URL. Route handlers never call OData directly — they delegate to
services (e.g. `knesset-bills.searchBills`, `knesset-committees.fetchCommitteeDetail`),
keeping handlers to validation + presentation.

## Data Flow

```text
src/data/*.json
  └─ static content only (about, faq, gallery, site, committee-url-mapping, trending-bills)
     — NOT imported for tracked parliament data

scripts/seed-data/*.json
  └─ curated baseline loaded via `npm run db:seed` (one-time setup)

frontend actions
  └─ /api/* through Vite proxy
      └─ server routes read/write Postgres via repositories and return typed data
```

All tracked parliament data, feature flags, knesset config, and summaries cache live in Postgres. The poller updates Postgres directly via repositories. There is no runtime JSON datastore.

## Poller

`server/index.ts` starts `startPoller()` when the Express server begins listening. The interval is controlled by `POLL_INTERVAL_MS` and defaults to 6 hours.

The poller:

- Checks bills through oknesset and marks changed status with `hasNewData`.
- Checks committee sessions and summarizes protocol files when available.
- Checks MK activity through the Knesset website API (`GetParlamentayActivity`), which returns private bills, plenary votes, and parliamentary questions in the same order the Knesset website displays them. Uses `knesset_site_id` (e.g. 1116) as the MK identifier.
- Updates `lastPolledAt`.
- Reclaims storage via `purgeOrphansIfNeeded` (`server/services/storage-manager.ts`): when
  `pg_database_size` exceeds `limit − slack`, deletes up to `ORPHAN_PURGE_BATCH` (default 5,
  env-overridable) of the **stalest orphan entities** — bills/committees/MKs that no user
  tracks (anti-join on the tracking tables, multi-user safe) — plus their children and an
  orphaned committee's session summary. Config is the **`storagePressure` feature flag**
  (DB-seeded, **on by default**): value `"limitMb:slackMb"` (e.g. `"450:2"`); value `"-1"`
  disables; when the flag row is absent the default `"450:2"` keeps it on. (Note: `untrack`
  only removes the tracking row, so entities become orphans that this step later reclaims.)
- All writes go through `BillsRepository`, `CommitteesRepository`, and `MksRepository` (Postgres). There is no JSON file writing.

The header badge is derived from `hasNewData` values. The current implementation does not clear those flags when the drawer opens.

## DB Module (`server/db/`)

Phase 2 of the JSON → Postgres migration is complete. All routes, poller, and services read/write Postgres.

- **`client.ts`** — driver-selecting factory. Under `NODE_ENV=test` it loads `@electric-sql/pglite` via `createRequire` (so the dev-only dep is never bundled) and returns a `drizzle-orm/pglite` instance. In all other environments it creates a `@neondatabase/serverless` `Pool` from `DATABASE_URL` and returns a `drizzle-orm/neon-serverless` instance.
- **`migrate.ts`** — runs Drizzle migrations from `server/db/migrations/` on server startup. Idempotent (Drizzle tracks applied migrations in `__drizzle_migrations`). Uses the matching migrator for the active driver (pglite or neon).
- **`schema/`** — per-domain schema files re-exported from `schema/index.ts`: `config.ts`, `bills.ts`, `committees.ts`, `mks.ts`, `caches.ts`, `annotations.ts`.
- **`server/repositories/`** — one class per domain. Each repository owns insert, upsert, and read. Reads reassemble normalized rows into typed aggregates (e.g. `MksRepository.getById` joins `mks` + `mk_knesset_terms` + `mk_roles` + `mk_activity` + `mk_votes` and derives `party` and `inactive`).

The migration design spec is in `docs/superpowers/specs/`.

## Directionality

The site is Hebrew-first. Direction-sensitive components use `useDirection()`, which reads `document.documentElement.dir` and returns `rtl` or `ltr`. The drawer side and selected icon mirroring follow that value.
