# Architecture

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18.3 + TypeScript 5.6 |
| Build/dev server | Vite 5.4 on `http://localhost:5173` |
| Styling | Tailwind CSS + shadcn-style UI primitives in `src/components/ui/` |
| Backend | Express 5 + `tsx`, running on `http://localhost:3001` |
| Data | Postgres via Neon/Docker — Drizzle ORM + `node-postgres`; pglite in tests. Entity, tracking, cache, config, feature flags, auth, email. `src/data/*.json` for static content only |
| External data | oknesset.org REST API, Knesset OData API (bills/committees/MKs), Knesset website (MK activity), Calendly API (Meet Us booking), Resend (email), Anthropic API (committee summaries) |
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
│   ├── App.tsx                  # Root: public page + ParliamentDrawer
│   ├── main.tsx
│   ├── index.css                # Tailwind, shadcn imports, theme tokens, fonts
│   ├── types.ts                 # Shared frontend/server TypeScript interfaces
│   ├── components/
│   │   ├── admin/               # AdminPanel (invites, users, templates, flags)
│   │   ├── layout/              # Header (+ AuthControl), Footer, ParliamentDrawer
│   │   ├── sections/            # Hero, ParliamentStrip, About, Gallery, FAQ, Join, MeetUs
│   │   ├── parliament/          # AddTrackingInput, Bill/Committee/MkCard, comboboxes, BillOverviewRow
│   │   └── ui/                  # shadcn-style primitives (button, card, sheet, tabs, accordion…)
│   ├── contexts/
│   │   ├── AuthContext.tsx      # Google sign-in state, token refresh, useAuth / useAuthOptional
│   │   └── ToastContext.tsx     # transient toast notifications
│   ├── hooks/
│   │   ├── useDirection.ts      # reads document.documentElement.dir → 'rtl' | 'ltr'
│   │   ├── useParliament.ts     # fetches /api/parliament/:type (tracked entities)
│   │   ├── useFeatureFlags.ts   # fetches /api/feature-flags
│   │   └── useBillsOverview.ts  # drives the three bills overview tabs
│   ├── lib/
│   │   └── api-client.ts        # typed wrappers around all /api routes
│   └── data/                    # Static JSON content only (about, faq, gallery, site; not tracking data)
├── server/
│   ├── index.ts                 # Express app, middleware, routes, poller startup, fetch-logger
│   ├── lib/
│   │   └── fetch-logger.ts      # globalThis.fetch interceptor → [api] outbound request logs
│   ├── middleware/
│   │   └── auth.ts              # requireAuth / requireAdmin / optionalAuth JWT middleware
│   ├── routes/                  # bills, committees, mks, tracking, parliament, auth, admin, analytics, meetings, knesset
│   ├── services/                # knesset-bills, knesset-committees, poller, email, calendly, summarizer, odata, url-parser, …
│   ├── repositories/            # one class per domain (Bills, Committees, Mks, Tracked*, Users, FeatureFlags, …)
│   └── db/
│       ├── client.ts            # driver-selecting factory (pglite in tests, node-postgres in prod)
│       ├── migrate.ts           # Drizzle migration runner on server startup
│       └── schema/              # per-domain Drizzle schema files
├── scripts/
│   └── seed-data/               # curated baseline JSON loaded by db:seed
├── tests/
├── docs/
├── BACKLOG.md
├── render.yaml                  # Render deployment config
└── vite.config.ts               # alias + /api proxy
```

## Frontend Flow

`App.tsx` renders a single scrolling Hebrew homepage:

```text
Header (includes AuthControl — Google sign-in / user menu / admin link)
main
  HeroSection
  ParliamentStrip
  AboutSection
  GallerySection
  FaqSection
  JoinSection
  MeetUsSection (anonymous visitors only; hidden when meetUs flag off)
Footer
ParliamentDrawer
```

The parliamentary drawer opens from the header and parliament strip. It has three tabs: bills, committees, and MKs. The drawer is populated by `useParliament()`, which initialises with empty state and immediately refreshes from the Express API on mount (no static JSON imports for tracked data).

## Backend API

`type` is one of `bill`, `committee`, or `mk`.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | health check |
| `GET` | `/api/parliament/:type` | reads tracked entities from DB, returns typed data |
| `POST` | `/api/tracking/add` | parse URL → fetch metadata → upsert entity + tracking row in DB |
| `DELETE` | `/api/tracking/:type/:id` | remove tracking row from DB by entity `id` |
| `POST` | `/api/summarize` | download PDF/DOCX → Claude → cache in DB (`summaries_cache`) |
| `GET` | `/api/feature-flags` | all feature flags as `Record<string, { enabled, value }>` |
| `GET` | `/api/bills/search` | search Knesset OData API |
| `POST` | `/api/bills/track` | add bill by Knesset bill ID |
| `GET` | `/api/bills/recent` | Bills Overview Recent tab (ordered by `BillID desc` or progress date) |
| `GET` | `/api/bills/trending` | Bills Overview Trending tab (curated list hydrated from OData) |
| `GET` | `/api/bills/policy-aligned` | Bills Overview Policy tab (keyword filter; hidden when flag off) |
| `GET` | `/api/committees/list` | list committees from Knesset API |
| `POST` | `/api/committees/track` | add committee by Knesset committee ID |
| `GET` | `/api/committees/info/:id` | fetch committee detail from Knesset OData |
| `GET` | `/api/mks/list` | list all Knesset members (cached 6 h) |
| `GET` | `/api/mks/activity` | fetch MK activity by `siteId` |
| `POST` | `/api/analytics/join` | fire-and-forget join click-through event |
| `POST` | `/api/meetings/booking-link` | **Public.** Verify Google identity, check Calendly for active booking, return single-use link. Rate-limited 10/min/IP + 5/min/email; `409` with existing meeting on repeat |
| `POST` | `/api/knesset/transition` | trigger Knesset transition (bump current number, re-stamp MK terms) |
| `POST` | `/api/auth/google` | exchange Google ID token for access + refresh tokens |
| `POST` | `/api/auth/refresh` | refresh access token |
| `POST` | `/api/auth/logout` | revoke refresh token |
| `GET` | `/api/auth/me` | current user profile (`requireAuth`) |
| `PATCH` | `/api/auth/me` | update display name or `emailAlerts` preference (`requireAuth`) |
| `GET` | `/api/admin/invites` | list allowlist emails (admin) |
| `POST` | `/api/admin/invites` | add allowlist email + send invitation email (admin) |
| `DELETE` | `/api/admin/invites/:email` | remove allowlist email (admin) |
| `GET` | `/api/admin/users` | list all users (admin) |
| `PATCH` | `/api/admin/users/:id/role` | update user role (admin) |
| `GET` | `/api/admin/email-templates` | list email templates (admin) |
| `PUT` | `/api/admin/email-templates/:name` | update email template (admin) |
| `PUT` | `/api/admin/feature-flags/:name` | update feature flag `{ enabled, value }` (admin) |

## Auth & multi-user

Closed, invite-only accounts via **Google sign-in** (GIS ID token → `POST /api/auth/google`,
verified server-side, gated by the `allowed_emails` allowlist). Sessions are **bearer JWTs**:
a short-lived access token (`Authorization: Bearer`) plus a rotating refresh token whose
sha256 hash is stored in `refresh_tokens` (invalidation = row deletion; reuse of a rotated
token revokes all of a user's sessions). Roles: `admin`, `member`, and an internal `group`
account that owns the public list. Middleware: `requireAuth` / `requireAdmin` / `optionalAuth`.

Auth and admin API routes are listed in the Backend API table above.

**Tracking scopes.** `GET /api/parliament/:type` returns the public **group** list by default;
`?scope=personal` returns the caller's list. Writes (`/tracking/add`, `DELETE`,
`/bills/track`, `/committees/track`) default to the caller's personal list; `?scope=group`
edits the public list and requires admin.

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
- Sends **bill-status alert digests** (`sendBillAlerts`): bills whose status changed this cycle
  are grouped per member into one email per member (personal trackers only, `email_alerts` on),
  sent throttled via `sendEmailsThrottled`. Isolated in try/catch so email never affects poll
  success. See **Email** below.
- Reclaims storage via `relieveStoragePressureIfNeeded` (`server/services/storage-manager.ts`):
  when `pg_database_size` exceeds `limit − slack`, runs a **reclaimer pipeline** cheapest-first,
  re-measuring between reclaimers and stopping once back under budget. Reclaimer 1 trims the
  oldest `SENT_EMAIL_PURGE_BATCH` (default 500) `sent_emails` ledger rows; Reclaimer 2 deletes up
  to `ORPHAN_PURGE_BATCH` (default 5) of the **stalest orphan entities** — bills/committees/MKs
  that no user tracks (anti-join on the tracking tables, multi-user safe) — plus their children
  and an orphaned committee's session summary. Config is the **`storagePressure` feature flag**
  (DB-seeded, **on by default**): value `"limitMb:slackMb"` (e.g. `"450:2"`); value `"-1"`
  disables; when the flag row is absent the default `"450:2"` keeps it on. (Note: `untrack`
  only removes the tracking row, so entities become orphans that this step later reclaims.)
- Pulls **email delivery status** (`pollDeliveryStatus`) for in-flight `sent_emails` rows — see **Email** below. Isolated; best-effort.
- All writes go through `BillsRepository`, `CommitteesRepository`, and `MksRepository` (Postgres). There is no JSON file writing.

The header badge is derived from `hasNewData` values. The current implementation does not clear those flags when the drawer opens.

## Email (Resend)

Transactional email over [Resend](https://resend.com). Server-side only; a no-op without `RESEND_API_KEY` so dev/test never send.

- **`server/services/email.ts`** — lazy `getResend()` client; `sendEmail({ to, template, params, raw? })` renders the template, sends, and records a minimal `sent_emails` ledger row (`sent`/`failed`); never throws. `sendEmailsThrottled` spaces sends (~2/s). Every log line redacts the address (`redactEmail`, local part only) and carries the Resend message id.
- **Templates** live in the DB (`email_templates`, rows `_layout`/`invite`/`bill_digest`/`bill_digest_item`), edited by admins via `GET/PUT /api/admin/email-templates`. `email-render.ts` exposes `renderTemplate` (wraps the body in `_layout`) and `renderFragment` (body only, for digest items) with `{{placeholder}}` substitution; values are HTML-escaped except those marked `raw`.
- **Use cases:** invitation emails send from `POST /api/admin/invites` **atomically** — `sendEmail` returns `sent`/`skipped`/`failed`; the route sends first and only writes the allowlist entry when the send did not fail (a `failed` send → `502`, no invite recorded; `skipped` = email unconfigured, treated as success). Bill-status alert digests are built by the poller (`sendBillAlerts`) for personal trackers with `users.email_alerts` on (toggle in `AuthControl`), and remain fire-and-forget relative to the poll cycle.
- **Delivery status (pull)** — `email-delivery-poll.ts` runs each poll cycle: it fetches Resend's `last_event` for non-terminal `sent_emails` rows (status not in `delivered/bounced/failed/suppressed/canceled/complained`, sent within the 30-day retention window, oldest-first, capped at `EMAIL_STATUS_POLL_CAP`=100 — exceeding the cap logs an over-sampling warning). On a change it advances `sent_emails.status` + `last_status_at` and logs `event/redacted-recipient/msgId`. Best-effort, isolated in the poller. (A near-real-time **webhook** alternative was reverted because Resend gates webhooks behind a paid plan — see BACKLOG.)
- **Env:** `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_SITE_URL`, optional `EMAIL_STATUS_POLL_CAP` (default 100) and `SENT_EMAIL_PURGE_BATCH`. Domain verification (SPF/DKIM/DMARC) is a one-time manual operator step. Design: `docs/superpowers/specs/2026-06-04-email-resend-design.md`.

## Meet Us (Calendly)

Outreach booking for **external visitors** (e.g. politicians) — they verify a Google identity but are never members. Fully stateless: **no lock table, no webhooks, no DB rows**; Calendly is the single source of truth.

- **`server/services/calendly.ts`** — lazy client (`CALENDLY_API_TOKEN` unset ⇒ unconfigured, no-op): `findActiveMeeting(email)` live-queries scheduled events (the one-active-booking gate; fail-closed on Calendly errors), `createSingleUseLink()` issues a `max_event_count: 1` scheduling link for the configured event type.
- **`server/routes/meetings.ts`** — public `POST /booking-link`: rate limit (`SlidingWindowLimiter`, 10/min/IP + 5/min/email) → `verifyGoogleIdToken` (no allowlist; identity used once, discarded) → gate → single-use link, or `409` with the existing meeting (start time + Calendly cancel/reschedule URLs, surfaced transiently).
- **`MeetUsSection`** — homepage, **anonymous visitors only** (signed-in members are the hosts; hidden for them and when the `meetUs` flag is off). Google button → booking link → Calendly popup embed prefilled with the verified name/email; confirmation on the embed's `event_scheduled` message.
- **Config:** the Calendly **event-type URI** lives in the `meetUs` feature flag value (admin panel, live — switching 1-on-1 / round-robin / panel is a config edit); only the API token is an env var.

## DB Module (`server/db/`)

Phase 2 of the JSON → Postgres migration is complete. All routes, poller, and services read/write Postgres.

- **`client.ts`** — driver-selecting factory. Under `NODE_ENV=test` it loads `@electric-sql/pglite` via `createRequire` (so the dev-only dep is never bundled) and returns a `drizzle-orm/pglite` instance. In all other environments it creates a `node-postgres` (`pg`) `Pool` from `DATABASE_URL` and returns a `drizzle-orm/node-postgres` instance — one driver for both local Docker Postgres and Neon (SSL is controlled by the connection string, not the driver).
- **`migrate.ts`** — runs Drizzle migrations from `server/db/migrations/` on server startup. Idempotent (Drizzle tracks applied migrations in `__drizzle_migrations`). Uses the matching migrator for the active driver (pglite or node-postgres).
- **`schema/`** — per-domain schema files re-exported from `schema/index.ts`: `config.ts`, `bills.ts`, `committees.ts`, `mks.ts`, `caches.ts`, `annotations.ts`, `tracking.ts`, `auth.ts`, `analytics.ts`, `email.ts`.
- **`server/repositories/`** — one class per domain. Each repository owns insert, upsert, and read. Reads reassemble normalized rows into typed aggregates (e.g. `MksRepository.getById` joins `mks` + `mk_knesset_terms` + `mk_roles` + `mk_activity` + `mk_votes` and derives `party` and `inactive`).

The migration design spec is in `docs/superpowers/specs/`.

## Directionality

The site is Hebrew-first. Direction-sensitive components use `useDirection()`, which reads `document.documentElement.dir` and returns `rtl` or `ltr`. The drawer side and selected icon mirroring follow that value.
