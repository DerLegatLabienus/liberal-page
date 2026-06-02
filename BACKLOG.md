# Backlog

### ✅ Join Flow Analytics — Click-Through Tracking — 2026-06-02

`JoinSelector` fires a fire-and-forget `POST /api/analytics/join {status, mode}` when a
user clicks through to the external effective-soft form. Stored in a single
`join_analytics` table: daily rows (1-year sliding window, pruned on write) + a `lifetime`
row, each with a per-`status:mode` breakdown. No identity/payment/submission data is
stored; the join flow is never blocked by analytics. DB-only — no read endpoint yet
(admin view is #16; completion tracking deferred, provider-dependent).
Spec: `docs/superpowers/specs/2026-06-02-join-analytics-design.md`.

The original config-endpoint idea (moving URL mapping/help text to a read-only endpoint)
was not pursued — the frontend selector remains the source of routing.

### ✅ Database Migration — 2026-06-01

Tracked parliament data moved from `src/data/*.json` to Postgres (Drizzle ORM +
`node-postgres`, single driver for local Docker and Neon; pglite in tests). Phase 1
introduced the schema, repositories, and startup migrations; Phase 2 cut the runtime
over (JSON datastore deleted, curated baseline moved to `scripts/seed-data/` + `npm run
db:seed`). Entity/tracking split with real FKs, per-user tracking against a single shared
account, derived currency (`Mk.party`/`inactive`, `Bill.inactive`). Deployed live to
Render against Neon. Specs: `docs/superpowers/specs/2026-05-30-database-migration-design.md`,
`2026-05-31-db-migration-phase2-design.md`.

## 3. User Accounts & Alerts (Priority: Low)

Member login, personalized tracking lists, email alerts on bill status changes.
Requires database (item 2 above) and an email service.

### ✅ API Layer — Centralized API Access (frontend + backend) — 2026-06-02

**Frontend:** all calls go through `src/lib/api-client.ts` (single base URL, headers, error
handling); no raw `fetch`/`axios` in components or hooks. (Implemented as one shared
client rather than per-module `api.ts` files — same goal.)

**Backend:** `server/services/odata.ts` (`odataGet` / `odataGetAllPages`) is the single
owner of the Knesset OData base URL, headers, error handling, and parsing. Route handlers
no longer call external APIs directly — bill search → `knesset-bills.searchBills`,
committee `/info` → `knesset-committees.fetchCommitteeDetail`; all 8 former `ODATA_BASE`
sites route through the helper. Spec/plan:
`docs/superpowers/specs/2026-06-02-backend-odata-centralization-design.md`.

### ✅ Closed Committees — Auto-Detect and Mark as Historical — 2026-06-02

Tracked committees absent from the Knesset OData `IsCurrent` active list are marked
`inactive` and shown as a historical record with a "Closed" badge (sessions stay visible;
manual removal only). Detection is a cheap DB cross-reference run after the committee-list
cache refresh, driven by the poller each cycle. Safety floor (≥10 active committees) prevents
mass false closures from a failed/empty fetch; reactivation is automatic on identical-id
reappearance. The combobox already excludes closed committees via the API filter. Pure
decision logic in `server/services/committee-status.ts`; refresh+reconcile in
`server/services/committee-list-refresh.ts`. Spec: `docs/superpowers/specs/2026-06-02-closed-committees-design.md`.

## 6. Knesset Transition — Handle Dispersal and New Knesset Election (Priority: Medium)

When the Knesset is dispersed or a new Knesset is elected, MKs and committees must be updated or removed to reflect the new composition.

**Requirements:**
- Track the current Knesset number (e.g. "כנסת 25") in the data layer
- When a dispersal or election is detected (via the Knesset API or a manual config flag):
  - MKs who did not win a seat in the new Knesset are marked inactive and removed from active views
  - Committees are re-fetched and stale/dissolved ones removed
  - Historical data (past protocols, bills) retains the MK/committee name as a non-interactive label
- The backend poller should detect Knesset transitions and trigger a full refresh of MK and committee data
- An admin/config mechanism to manually trigger the transition in case the API is slow to reflect results

**Notes:**
- Israeli elections can be called with little notice — this should be treated as a supported runtime event, not a manual migration

### ✅ Media Migration — Fetch Event Photos from likudliberal.org — 2026-05-25

Playwright script crawls likudliberal.org, downloads 11 images to `public/images/gallery/`, rewrites `src/data/gallery.json` to use local paths. Extension whitelist prevents non-image assets from being captured. Script at `scripts/migrate-media.ts` — run with `npx tsx scripts/migrate-media.ts`.

## 8. Upgrade Node.js Version (Priority: Low)

The current runtime is Node v21.7.3 (an odd/non-LTS release). Upgrade to the latest LTS version.

**Requirements:**
- Upgrade to the latest Node LTS (v22.x at time of writing)
- Add an `.nvmrc` or `engines` field in `package.json` to pin the expected version
- Verify all dependencies (Vite, tsx, Express) are compatible after the upgrade
- Update CI/CD pipeline to use the same LTS version

## 9. Live Parliamentary Content Translation (Priority: Low)

Parliamentary content items (bill titles, MK names, committee names, activity descriptions) are stored as plain Hebrew strings from the Knesset API. No English source exists.

**Requirements:**
- Each parliamentary data item carries a stable identity (its Knesset numeric ID)
- A translation cache maps `{ id → { he: string, en: string } }` — stored alongside the existing JSON data
- On first English-mode view, translations are requested (via LLM or translation API) and written to the cache
- Components check the cache before falling back to the raw Hebrew string
- The cache is persisted between server restarts
- Depends on: item 2 (database) for long-term cache storage

### ✅ Storage Pressure — Purge Orphaned (Untracked) Entities — 2026-06-03

`untrack` only removes the tracking row, leaving the entity + children as orphans. On each
poll cycle, when `pg_database_size` exceeds `STORAGE_LIMIT_MB − STORAGE_SLACK_MB` (opt-in;
no-op if `STORAGE_LIMIT_MB` unset), the poller deletes up to `ORPHAN_PURGE_BATCH` (default 5)
of the **stalest orphan entities** — bills/committees/MKs tracked by no user (anti-join on
the tracking tables, multi-user safe) — plus their children and an orphaned committee's
session summary, **stalest first** (oldest `lastPolledAt`). Sheds the minimum per cycle so
already-extracted data is preserved; converges across cycles. API list caches are never
touched; each deletion is logged to the server console. No schema change. Scoped down from
the original LRU/eviction-log/discarded-card/toast sketch — if orphan purging proves
insufficient we will revisit. `server/services/storage-manager.ts`,
`server/db/size.ts`; spec `docs/superpowers/specs/2026-06-02-storage-pressure-design.md`.

## 18. Knesset Bills Overview — Phase 2 (Recent v2 + extra trending algorithms) (Priority: Medium)

Phase 1 shipped the three-tab "Knesset Bills Overview" section (Recent = newest by `BillID desc`, Trending = manual curation, Policy-aligned = keyword match). Phase 2 enhancements, gated behind feature flags that already exist in `src/data/feature-flags.json`:

- **`recentRanking: "progress"`** — re-rank the Recent tab by the most recent *genuine legislative event* per bill (committee/plenum session dates), not creation order. Building blocks verified: `KNS_CmtSessionItem` (`ItemID`/`ItemTypeID` + `CommitteeSessionID`) and `KNS_PlmSessionItem` join bills to sessions, which carry reliable `StartDate`. This is a backend aggregation subsystem — needs its own spec. Do NOT use `KNS_Bill.LastUpdatedDate` (administrative-only; surfaced old bills as "recent" in a prior incident).
- **`trendingAlgorithm: "amendments" | "sponsorship"`** — currently fall back to `manual`. Require OData entities not yet verified (per-bill amendment count; cross-party co-sponsor join). Research needed before implementing.
- **Committee name on overview rows** — `KnessetBillOverviewItem.committee` is currently `''` (Phase 1). Resolve `KNS_Bill.CommitteeID` → name via `knesset-committees-cache.json` (note: that cache is runtime-generated and may be absent until the poller runs).

Spec: `docs/superpowers/specs/2026-05-26-knesset-bills-overview-design.md`. Phase 1 plan: `docs/superpowers/plans/2026-05-26-knesset-bills-overview.md`.

## 11. MK Faction History — Mid-Term Defections (Priority: Low)

The database migration (item 2) models MK party affiliation in `mk_knesset_terms`
as **one faction per (MK, Knesset)** with a `unique(mk_id, knesset_number)`
constraint. This captures party migration *between* Knessets but not mid-term
defections (an MK switching factions *within* a single Knesset).

**When needed:** if the product wants to display an MK's faction *timeline*
("sat with faction A until March, then faction B").

**Forward-compatible upgrade path (no breaking change):**
- Relax the `unique(mk_id, knesset_number)` constraint to allow multiple faction
  stints per term.
- Add `start_date` / `end_date` to `mk_knesset_terms` (faction periods).
- Repository derives "current faction" from the open-ended (`end_date IS NULL`)
  stint of the current Knesset — `Mk.party` keeps its `string` shape, so no
  consumer changes.
- Add an optional `Mk.factionHistory?: { faction, startDate, endDate }[]` and a
  `MkCard` timeline element to surface it.

The migration spec (item 2) stores enough to make this purely additive later.

## 12. Database Credential Secret Management (Priority: Low)

Today the Render service receives `DATABASE_URL` as a `sync: false` env var (Render's
encrypted secret store, injected at runtime — the standard 12-factor approach).

**Original idea:** assemble `DATABASE_URL` in code from `DB_USER`/`DB_PASS` secrets
rather than storing the whole URL.

**Decision / nuance (discussed 2026-05-31):** splitting the URL into user/pass env
vars gives **no security gain** — the components live in the same place with the
same exposure as the full URL, and the assembled string still exists in process
memory at runtime. Do **not** implement URL-from-env-components for its own sake.

**What would actually improve the posture** (the real concern is long-lived
plaintext credentials, which is legitimate):
- **Runtime secrets manager** (Vault / AWS Secrets Manager / Doppler / Infisical /
  GCP Secret Manager): central rotation, audit logs, least privilege, short TTLs.
  Caveat: still needs a bootstrap credential in the env to authenticate to it.
- **Short-lived / rotating DB credentials** (IAM-style DB auth, or Neon role
  rotation) — the win is a password valid for minutes, not "no env var."
- **Render secret files** (mount secret as a file) — marginally different exposure.

**Scope when picked up:** brainstorm/spec which approach fits a free-tier Render +
Neon setup (likely Neon credential rotation + a small fetch-at-startup helper in
`server/db/client.ts`), measured against the bootstrap-credential and complexity
cost. Not worth doing as plain URL-assembly.

## 13. Knesset Transition — Re-stamp MK Terms on Transition (Priority: Medium)

Found in the Phase 2 final review. `server/services/knesset-config.ts` `runTransition`
bumps `current_knesset` and clears the list caches, but the DB-migration **spec §4
called for re-stamping `mk_knesset_terms` for the new Knesset** — and that step was
not implemented.

**Consequence:** after a real Knesset transition, no tracked MK has a term matching
the new `current_knesset`, so `MksRepository.getById` derives `inactive: true` and
falls back to the last historical faction for **every** MK. Worse, `pollMks` filters
`!m.inactive`, so those MKs are then **permanently excluded from polling** (no
self-healing) — a catch-22.

**Fix:** in `runTransition`, after `configRepo.set(newKnesset)`, re-fetch each tracked
MK's identity and add an `mk_knesset_terms` row for `newKnesset` (a targeted
`MksRepository.addTerm(mkId, knessetNumber, faction)` is cleaner than a full re-poll,
which the inactive-filter would skip). Rare event (manual trigger), so non-urgent, but
it silently breaks MK currency when it does fire.

### ✅ Re-stamp MK Terms on Transition — 2026-06-01

`MksRepository.addTerm(mkId, knessetNumber, faction)` and `getAllBasic()` added. `runTransition` now iterates all tracked MKs, calls `getMkBySiteId` for each, and inserts a term for the new Knesset if `isCurrent`. Per-MK fetch failures are swallowed so a single lookup error can't abort the whole transition. Covered by `tests/server/mks-repository-addterm.test.ts` (2 tests) and a new describe block in `tests/server/knesset-config.test.ts`.

## 14. Entity Dedup on Tracking Add (Priority: Low)

✅ resolved (commit 94bdf0f) — app-level dedup via `getAll().find()` on natural key in
`tracking.ts /add` for all three types; `bills.ts /track` now stores `oknessetId:
String(billId)` instead of empty string. 3 new dedup tests + 1 oknesset_id assertion.

Found in the Phase 2 final review (pre-existing behavior, carried through the cutover —
**not** a Phase-2 regression). `server/routes/tracking.ts` `POST /add` upserts the
entity unconditionally, and the entity-repo `upsert`s are plain `INSERT`s (no unique
constraint on `oknesset_id`). Re-adding the same URL inserts a duplicate entity row +
tracking row → a visible duplicate in `GET /:type`. (`bills.ts`/`committees.ts /track`
already dedup by scanning `getAll()`; `tracking.ts /add` does not, and MKs have no
dedup path at all.)

**Fix:** add a unique constraint on each entity's natural key (`bills.oknesset_id`,
`committees.oknesset_id`, `mks.oknesset_id` / `knesset_site_id`) and make the repo
`upsert`s real (`onConflictDoUpdate`), so `tracking/add` becomes idempotent for all
three types. **Minor cleanup also noted:** `CommitteeCard`'s `trackedMks` prop is
currently unused (the attending-MK-name lookup depended on `attendingSiteIds`, which
the enricher always returns empty) — remove the dead prop or wire the feature.

## 15. "Meet Us" — Scheduled Meetings with Cell Members (Priority: Low)

A **"Meet Us"** section on the home page that lets a **registered** user book an
automatic meeting with people from the political cell. Meetings are conducted
externally — an auto-generated **Zoom** link (via Calendly) or an **in-person**
location — the app never hosts them.

**Requirements (as described):**
- New home-page section (Hebrew-first, rendered alongside the other home sections).
- Scheduling via **Calendly**: Calendly's group/round-robin "teams" define how the
  cell members (hosts) are selected; the booking link is **brokered through the
  backend** (the backend issues/guards the scheduling link rather than linking to
  Calendly directly).
- **Registered users only** — depends on **item 3 (User Accounts & Alerts)**, which
  provides login + per-user identity. Intended login is **"Sign in with Google" (OAuth)**:
  a verified identity + email with no password storage on our side. This means #3 can ship
  as Google OAuth alone (no email/password/reset system) and still satisfy this gate.
- **One active booking per user** — a user cannot book again until their current
  meeting is over or cancelled.
- **No meeting data stored** in our backend; meetings happen on Zoom / in person.

**Open tensions to resolve at design time (do NOT skip these):**
1. **"No data stored" vs. "one active booking per user" — these conflict.**
   Enforcing one active booking requires *some* per-user state. Reconcile by storing
   only a **minimal, opaque lock** (e.g. `user_id` → an active-booking reference +
   the meeting's scheduled end time), explicitly **not** meeting content (no
   attendees, topic, notes, location). Decide precisely what "no data" excludes.
   Alternative: hold no state and query the Calendly API for the user's existing
   scheduled events at booking time.
2. **Calendly data residency.** Calendly itself stores the booking (name, email,
   time) on its side. Confirm "no data stored" means *our* backend only.
3. **Booking lifecycle / releasing the lock.** Calendly does not emit a "completed"
   event, so the backend needs Calendly **webhooks** (`invitee.created` to set the
   lock, `invitee.canceled` to clear it) plus an **expiry by the scheduled end time**
   to release the lock after the meeting passes.
4. **Host selection / meeting type — DEFERRED, must be swappable.** Whether a booking
   is a 1-on-1 with a rotating representative (Calendly **round-robin**), a session with
   a fixed panel (**collective**), or a managed group event is **intentionally left open**
   and decided later. The implementation must NOT hard-wire one mode: the meeting type and
   host pool live behind a single configuration/strategy seam (e.g. a Calendly event-type
   identifier + host list in config, or a small `meetingStrategy` abstraction) so changing
   "who you meet and how many" is a config edit, not a code rewrite. Auth gate, the
   one-active-booking lock, and the brokering flow are identical regardless of which mode
   is chosen — only the Calendly event reference changes.
5. **Backend brokering flow.** Likely: logged-in user clicks "Meet Us" → backend
   checks no active lock → backend creates a single-use Calendly scheduling link
   (Calendly API) → embed/redirect → on `invitee.created` webhook set the lock with
   the end time → on `invitee.canceled`/expiry clear it. No meeting content persisted.

**Depends on:** item 3 (User Accounts) for the auth gate and user identity. The
DB + per-user model (item 2, shipped) already provides a place for the minimal lock
(a new `meeting_locks`-style table keyed by `user_id`).

## 16. Expose Join Analytics — Admin-Panel Read View (Priority: Low)

The Join-section click-through analytics (see ✅ Join Analytics) are collected and
stored in the `join_analytics` table but **deliberately not exposed** by any endpoint.
When an admin panel exists, surface this data behind it.

**Requirements:**
- A read endpoint (e.g. `GET /api/analytics/join`) returning the lifetime row plus the
  ≤365-day daily series with per-combination breakdowns — gated behind admin auth.
- An admin-panel view rendering the daily trend and the all-time total/breakdown.
- Until the admin panel and its auth gate exist, the data stays DB-only (query
  `join_analytics` directly via SQL).

**Depends on:** an admin panel + auth (related to item 3, User Accounts).

## 17. Site-Wide Product Analytics (Priority: Low — Advanced)

A general analytics layer covering **every** feature on the site (section views,
combobox usage, tracking add/remove, drawer opens, language toggles, gallery
interactions, etc.), not just the Join click-through.

This is a large, cross-cutting subsystem and should only be taken on when the product
genuinely needs per-feature engagement data. Considerations to brainstorm at that time:

- **Event model:** a generic `events` table (or time-bucketed aggregates like the
  join-analytics design) vs. a third-party analytics SaaS (Plausible / PostHog /
  Umami — privacy-friendly, self-hostable options exist).
- **Budget:** raw per-event storage grows fast; favor daily/weekly roll-ups or a
  hosted free tier. Reuse the bucketed single-table pattern from Join Analytics where
  possible.
- **Privacy:** no PII; aggregate/anonymous only, consistent with the site's stance.
- **Separation:** keep all analytics in dedicated repos/tables, isolated from business
  logic (as established by the Join Analytics design).

**Notes:** Treat as a someday/maybe until there's a concrete need to measure specific
features. Not a near-term item.

---

## Completed

Items shipped. Kept for retrospective and reference.

### ✅ Multi-Language Support (i18n) — 2026-05-17

Full Hebrew/English language switching using `react-i18next`. Language toggle in Header sets `document.documentElement.dir`, which `useDirection()` observes. All public sections translated (Hero, About, FAQ, Gallery, Join, ParliamentDrawer tabs). Language persisted in `localStorage`.

### ✅ MK Selection — Combobox — 2026-05-18

Searchable `MkCombobox` in the parliament drawer MK tab. Supports `isLiberal` and `isSupporter` flags with distinct icons. Selecting an MK loads their card and activity feed inline.

### ✅ Bill Selection — Combobox — 2026-05-18

`BillSearchCombobox` searches bills by title or number across the full Knesset bill database. Older tracked bills retain their direct `knessetUrl` link alongside the card.

### ✅ Knesset Committee Selection — Combobox — 2026-05-18

`CommitteeCombobox` lists all active Knesset committees with search. Closed committees are excluded. Selecting a committee displays its card and recent session data.

### ✅ GitHub Pages + Render deployment — 2026-05-19

Frontend deployed to GitHub Pages (`https://derlegatlabienus.github.io/liberal-page/`). Express backend deployed to Render (`https://liberal-page.onrender.com`). GitHub Actions CI (lint → tsc → test → build → smoke test) and deploy workflows in place.
