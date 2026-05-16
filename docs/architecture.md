# Architecture

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18.3 + TypeScript 5.6 |
| Build/dev server | Vite 5.4 on `http://localhost:5173` |
| Styling | Tailwind CSS + shadcn-style UI primitives in `src/components/ui/` |
| Backend | Express 5 + `tsx`, running on `http://localhost:3001` |
| Data | JSON files in `src/data/`; imported by the frontend and read/written by the server |
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

Starting the backend also starts the poller. The poller can update tracked JSON files under `src/data/`.

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

The parliamentary drawer opens from the header and parliament strip. It has three tabs: bills, committees, and MKs. The drawer is populated by `useParliament()`, which starts from static JSON imports and then refreshes from the Express API.

## Backend API

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/api/health` | Returns server health and timestamp |
| `GET` | `/api/parliament/:type` | Reads tracked JSON, attempts fresh external metadata, writes refreshed JSON, returns data |
| `POST` | `/api/tracking/add` | Parses URL or raw ID, fetches metadata, appends item to tracked JSON |
| `DELETE` | `/api/tracking/:type/:id` | Removes a tracked item by local numeric `id` |
| `POST` | `/api/summarize` | Downloads a PDF/DOCX, summarizes it, and stores the result in `summaries-cache.json` |

`type` is one of `bill`, `committee`, or `mk`.

Supported URL parsing currently includes:

- `oknesset.org/bill/<id>`
- `oknesset.org/member/<id>`
- `oknesset.org/committee/<id>`
- Knesset committee URLs with `CommitteeId=<id>`
- Knesset bill URLs with `BillId=<id>`
- Knesset MK URLs under `/mk/Apps/mk/mk-positions/<siteId>` and `/mk/mk-detail/<siteId>`

The UI mentions `gov.il`, but general `gov.il` parsing is not implemented in the current parser.

## Data Flow

```text
src/data/*.json
  ├─ imported directly by frontend as initial state/static content
  └─ read and written by Express routes and poller

frontend actions
  └─ /api/* through Vite proxy
      └─ server routes update JSON and return typed data
```

The JSON files are intentionally the current local datastore. Running the backend, adding/removing tracked items, opening pages that trigger refreshes, or the poller can mutate tracked data files.

## Poller

`server/index.ts` starts `startPoller()` when the Express server begins listening. The interval is controlled by `POLL_INTERVAL_MS` and defaults to 6 hours.

The poller:

- Checks bills through oknesset and marks changed status with `hasNewData`.
- Checks committee sessions and summarizes protocol files when available.
- Checks MK activity through the Knesset OData scraper.
- Updates `lastPolledAt`.
- Writes each JSON file only when tracked content changed, though some route refreshes write timestamps independently.

The header badge is derived from `hasNewData` values. The current implementation does not clear those flags when the drawer opens.

## Directionality

The site is Hebrew-first. Direction-sensitive components use `useDirection()`, which reads `document.documentElement.dir` and returns `rtl` or `ltr`. The drawer side and selected icon mirroring follow that value.
