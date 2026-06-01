# Backlog

## 1. Join Flow Analytics / Config (Priority: Low)

`JoinSection` uses a frontend-only selector that routes users to the correct
effective-soft form. The site does not collect or store membership details.

Potential future enhancement: move the URL mapping/help text to a read-only
config endpoint or add anonymous click analytics. Do not proxy submissions or
store identity/payment/signature data locally.

## 2. Database Migration (Priority: Medium)

Replace `src/data/*.json` files with a proper database (PostgreSQL or SQLite).
All server services already read/write through helper functions (`readItems`, `writeItems`)
in each route file — swap those functions for repository calls.

## 3. User Accounts & Alerts (Priority: Low)

Member login, personalized tracking lists, email alerts on bill status changes.
Requires database (item 2 above) and an email service.

## 4. API Layer — Centralize All API Calls per Module (Priority: Medium)

All API calls should go through a dedicated API layer inside each module.

**Requirements:**
- Each feature module has its own `api.ts` file that owns all fetch calls for that domain
- Components and hooks import from the API layer only — no raw `fetch`/`axios` calls in components
- The API layer is the single place to set base URLs, headers, error handling, and response shaping
- Backend route files follow the same pattern: routes call services only, no direct Knesset API calls in handlers

## 5. Closed Committees — Auto-Remove from All Views (Priority: Medium)

When a Knesset committee is closed/dissolved, it should be removed from the UI everywhere it appears.

**Requirements:**
- Committee data includes an `active` boolean (or a `closedDate` field) sourced from the Knesset API
- Any component that lists or references committees filters out inactive ones
- Protocols and MK cards that reference a now-closed committee display the committee name as plain text (historical record) rather than a selectable/linked item
- The backend poller should keep committee status up to date

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

## 10. Storage Pressure — Graceful Eviction of Stale Tracked Items (Priority: Medium)

When the Postgres database (Render free tier or equivalent) approaches its storage limit,
adding new tracked items should evict the least-valuable existing rows rather than silently
failing or crashing. Users whose items are evicted should see a clear placeholder, not a
broken UI.

**Design — usage-stats columns:**
Add lightweight staleness signals to each tracked entity table (bills, committees, MKs):
- `last_accessed_at` — updated on every read
- `access_count` — incremented on every read
- `tracked_by_count` — number of distinct users tracking this item
- `created_at` — already present

A staleness score (e.g. time-decay-weighted access count) ranks candidates for eviction.
Lowest-scoring rows are removed first.

**Eviction rules:**
- Never remove a row that has referential dependents (e.g. a bill referenced by a cached
  protocol summary in `summaries_cache`)
- Remove the minimum number of rows needed to restore the configured slack
- Evicted rows are written to an `eviction_log` table (ring buffer, capped at 50 entries by
  default, configurable via `EVICTION_LOG_SIZE`) preserving name/title, type, and original ID

**Slack budget:** `STORAGE_SLACK_MB` env var (default `2`). `storageManager.ensureSlack()` is
called by repositories before every insert that could grow the DB.

**UX — discarded placeholder:**
If a tracked item's ID is in `eviction_log` but missing from its entity table, the frontend
renders a "Discarded" card showing:
- Item name/title (from eviction log)
- Type (bill / committee / MK) and original Knesset ID
- "Re-add" button that re-fetches and re-tracks the item
- Muted label: "Removed due to storage limits"

**Graceful failure path:**
If eviction itself fails or the insert still fails afterward, the backend returns a structured
error. The frontend shows an error toast: "Could not save — storage is full. Try removing an
item you no longer need."

**Requirements:**
- `STORAGE_SLACK_MB` and `EVICTION_LOG_SIZE` env vars in `.env.example`
- Usage-stat columns added to entity tables via a new Drizzle migration
- `server/services/storage-manager.ts` — measures current DB size, scores rows, runs eviction
- Repositories call `storageManager.ensureSlack()` before entity inserts
- `eviction_log` Drizzle schema + `EvictionLogRepository`
- "Discarded" card variant for BillCard, CommitteeCard, MkCard
- Error toast via existing notification system

**Notes:**
- Revisit eviction policy and budget when migrating to a paid DB tier

### ✅ CommitteeCard — Recent Sessions with Links — 2026-05-25

CommitteeCard shows up to 5 recent sessions from Knesset OData. Most recent is extended (title, date, AI summary, liberal MK badges with names). Up to 3 additional compact rows. Links use canonical OData SessionUrl.

### ✅ Poller — Backoff on Failure — 2026-05-25

Exponential backoff on total poll failure: starts at 1 min, doubles each cycle, caps at 10 min. Successful cycle resets to normal interval (POLL_INTERVAL_MS, default 6 h).

### ✅ Shareable Language Links — `?lang=en` URL param — 2026-05-25

`detectInitialLanguage()` reads `?lang=` on init and persists to localStorage. Language toggle updates URL via `history.replaceState`. Tested in `tests/unit/detectInitialLanguage.test.ts` and `tests/components/Header.test.tsx`.

### ✅ MK Card — Submitted Bills and Parliamentary Queries — 2026-05-18

Activity feed in `MkCard` displays `bill_initiated` (📋) and `question` (❓) items with dates and direct links to the official Knesset record. Data is fetched via the Knesset scraper service on the backend and stored in `mks.json`.

## 10. Knesset Bills Overview — Phase 2 (Recent v2 + extra trending algorithms) (Priority: Medium)

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
  provides login + per-user identity.
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
4. **Host selection.** Define the host pool and rotation (Calendly round-robin /
   collective / managed-event team).
5. **Backend brokering flow.** Likely: logged-in user clicks "Meet Us" → backend
   checks no active lock → backend creates a single-use Calendly scheduling link
   (Calendly API) → embed/redirect → on `invitee.created` webhook set the lock with
   the end time → on `invitee.canceled`/expiry clear it. No meeting content persisted.

**Depends on:** item 3 (User Accounts) for the auth gate and user identity. The
DB + per-user model (item 2, shipped) already provides a place for the minimal lock
(a new `meeting_locks`-style table keyed by `user_id`).

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
