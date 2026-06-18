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

### ✅ Email — Invitations + Bill-Status Alert Digests (#3b) — 2026-06-04

Transactional email via **Resend**. Invitation emails fire (fire-and-forget) when an admin
adds an allowlist email. Bill-status **alert digests** are sent by the poller once per cycle
to personal trackers (one grouped email per member), gated by a per-user `email_alerts`
opt-out toggle. Templates are **stored in the DB** (`email_templates`) and editable in the
admin panel via one generalized `renderTemplate(name, params)`. Delivery status is **pulled**
by the poller each cycle (`email-delivery-poll.ts`): it fetches Resend's `last_event` for
non-terminal `sent_emails` rows (within the 30-day retention window, oldest-first, capped at
`EMAIL_STATUS_POLL_CAP`=100 with an over-sampling warning), advancing `status` + `last_status_at`
and logging a redacted recipient + Resend message id on change. The `sent_emails` ledger is the
first table trimmed by the generalized storage-pressure **reclaimer pipeline**
(`relieveStoragePressureIfNeeded`). Email is a no-op without `RESEND_API_KEY`, so dev/test never
send. Spec: `docs/superpowers/specs/2026-06-04-email-resend-design.md`;
plan: `docs/superpowers/plans/2026-06-04-email-resend.md`.

### 🔲 Open — Webhook-based real-time delivery status (requires paid Resend plan)

We initially built a log-only delivery webhook (`POST /api/webhooks/resend`, svix-verified) but
**reverted it** because Resend gates webhooks behind a paid plan; delivery status is pulled
instead (see above). If/when the account is upgraded, the webhook gives near-real-time status
(vs. the up-to-6h polling lag) and removes the per-cycle retrieve calls. The implementation is
preserved in git at commit `caaa8f9` (revert) — restore `server/routes/webhooks.ts`, its test,
the `svix` dep, the `express.json()`-ordering mount in `server/index.ts`, and the
`RESEND_WEBHOOK_SECRET` env var; then register the endpoint in the Resend dashboard. Polling and
the webhook can also coexist (webhook for freshness, poll as backfill).

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

✅ **Fully implemented** across several sub-items (see below). All requirements satisfied.

When the Knesset is dispersed or a new Knesset is elected, MKs and committees must be updated or removed to reflect the new composition.

**Requirements (all met):**
- ✅ Track the current Knesset number — `knesset_config` table + `KnessetConfigRepository`
- ✅ MKs who did not win a seat marked inactive — `runTransition` adds terms only for MKs where `isCurrent`, so those without a new term derive `inactive: true` from the repository
- ✅ Committees re-fetched and stale/dissolved ones removed — transition clears committee list cache; next `refreshCommitteeListIfStale` + closed-committee reconciliation handles removal
- ✅ Historical data preserved — `inactive` flag keeps entities with their history; removed only by explicit untrack
- ✅ Poller detects transitions automatically — `detectKnessetTransition()` runs once per poll cycle
- ✅ Manual admin trigger — `POST /api/knesset/transition` for API-lag cases

### ✅ Auto-detect Knesset Transition in Poller — 2026-06-13

`detectKnessetTransition()` was already implemented in `server/services/knesset-config.ts` (queries `KNS_PersonToPosition?PositionID=43` for the current Speaker's `KnessetNum`; runs `runTransition()` if it exceeds `config.currentKnesset`). The poller now calls it once per cycle, isolated, **before** entity polls so `getCurrentKnesset()` reflects the new number in the same cycle. A detected transition is logged. A failed check never aborts entity polling. Manual trigger via `POST /api/knesset/transition` remains available for API-lag cases.

### ✅ Media Migration — Fetch Event Photos from likudliberal.org — 2026-05-25

Playwright script crawls likudliberal.org, downloads 11 images to `public/images/gallery/`, rewrites `src/data/gallery.json` to use local paths. Extension whitelist prevents non-image assets from being captured. Script at `scripts/migrate-media.ts` — run with `npx tsx scripts/migrate-media.ts`.

### ✅ Upgrade Node.js Version — 2026-06-13

Added `.nvmrc` (22), `engines: { "node": ">=22" }` in `package.json`, and bumped both CI/deploy workflows from Node 20 → 22 LTS. Type-check clean; pre-existing test failures unrelated.

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
poll cycle, when `pg_database_size` exceeds `limit − slack`, the poller deletes up to
`ORPHAN_PURGE_BATCH` (default 5) of the **stalest orphan entities** — bills/committees/MKs
tracked by no user (anti-join on
the tracking tables, multi-user safe) — plus their children and an orphaned committee's
session summary, **stalest first** (oldest `lastPolledAt`). Sheds the minimum per cycle so
already-extracted data is preserved; converges across cycles. API list caches are never
touched; each deletion is logged to the server console. No schema change. Configured by the
`storagePressure` feature flag (DB-seeded, **on by default**), value `"limitMb:slackMb"`
(e.g. `"450:2"`); value `"-1"` disables. Scoped down from the original
LRU/eviction-log/discarded-card/toast sketch — if orphan purging proves insufficient we will
revisit. `server/services/storage-manager.ts`, `server/db/size.ts`; spec
`docs/superpowers/specs/2026-06-02-storage-pressure-design.md`.

## 18. Knesset Bills Overview — Phase 2 (Recent v2 + extra trending algorithms) (Priority: Medium)

Phase 1 shipped the three-tab "Knesset Bills Overview" section (Recent = newest by `BillID desc`, Trending = manual curation, Policy-aligned = keyword match). Phase 2 enhancements, gated behind feature flags stored in the DB (`FeatureFlagsRepository` / `useFeatureFlags`):

- **`recentRanking: "progress"`** — ✅ **Implemented 2026-06-13. Bug-fixed 2026-06-14.** Re-ranks the Recent tab by the most recent committee session appearance (`maxCommitteeSessionID` as recency proxy — verified sequential). Fetches a 200-bill pool, queries `KNS_CmtSessionItem` in chunks of 40 (URL-encoded; Knesset OData returns 400 on unencoded filters and 404 when the URL exceeds ~2000 chars), computes max per bill, re-sorts descending, returns top `limit`. Bills with no sessions sort to the bottom. 30-min cache keyed by Knesset number. Activate by setting the `recentRanking` flag value to `"progress"` in the admin panel. Do NOT use `KNS_Bill.LastUpdatedDate` (administrative-only; surfaced old bills as "recent" in a prior incident). DB migration `0016_recent_ranking_flag.sql` seeds the flag row on existing deployments. Spec: `docs/superpowers/specs/2026-06-13-bills-overview-phase2-design.md`.
- **`trendingAlgorithm: "amendments" | "sponsorship"`** — currently fall back to `manual`. OData entities **verified 2026-06-13**: `KNS_BillUnion` (MainBillID count = merged-bills proxy) and `KNS_BillInitiator` (PersonID count = co-sponsors). Implementation pattern identical to the progress-ranking OData call. **Caveat:** both return empty for recent Knesset 25 bills — data builds up over months as bills advance. Not useful for trending in the current Knesset until the term matures. See spec for full schema details.
- **Committee name on overview rows** — ✅ Already implemented: `mapRows` in `server/services/knesset-bills.ts` resolves `CommitteeID` → name via `CommitteeListRepository` (in-memory cache, 5 min TTL). Shows `''` only before the poller's first committee-cache refresh — best-effort, not a bug.

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
the enricher always returns empty) — ~~remove the dead prop or wire the feature~~ ✅ prop removed 2026-06-13.

## 15. "Meet Us" — Scheduled Meetings with Cell Members (Priority: Low)

### ✅ Meet Us — External Visitors Book via Calendly — 2026-06-12

Shipped with a **revised audience**: the section is for **external visitors** (politicians),
shown to **anonymous visitors only** — signed-in members are the hosts and don't see it.
Visitors verify a **Google identity per request** (no allowlist, no user row, no session) at
the public `POST /api/meetings/booking-link`, which live-queries Calendly to enforce **one
active booking per verified email** (stateless pull — the lock-table + webhook sketch below
was rejected; no DB rows at all) and issues a single-use, prefilled Calendly link opened in a
popup embed. Repeat attempts get a `409` carrying the existing meeting + Calendly
cancel/reschedule links. Rate-limited (10/min/IP, 5/min/email); fail-closed on Calendly
errors. The event-type URI (1-on-1 / round-robin / panel — tension #4's swappable seam) lives
in the `meetUs` feature-flag value, editable live in the admin panel; only
`CALENDLY_API_TOKEN` is an env var. Spec: `docs/superpowers/specs/2026-06-12-meet-us-design.md`;
plan: `docs/superpowers/plans/2026-06-12-meet-us.md`.

### ✅ Meet Us — Seed gap fixed — 2026-06-13

`meetUs` flag added to `scripts/seed-data/feature-flags.json` (enabled: false, value: null) and wired into `seed-db.ts`. Fresh `db:seed` now creates the flag row; operator sets the Calendly event-type URI value and enables it via the admin panel.

**Original item (historical):**

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

### ✅ Expose Join Analytics — Admin-Panel Read View — 2026-06-13

`JoinAnalyticsRepository.getAll()` added. `GET /api/admin/analytics/join` (requireAdmin) returns
`{ lifetime, daily }` — the all-time row and daily rows newest-first. The AdminPanel loads
this alongside its other data on open and shows: all-time total click count, per-combo breakdown
sorted by count, and a collapsible last-14-days list. TypeScript types added to `api-client.ts`
(`JoinAnalyticsRow`, `JoinAnalyticsData`).

## 19. Civic Letters — Member Letter-Sending System (Priority: Medium) ✅ SHIPPED 2026-06-14

Admin-curated letters addressed to MKs, ministers, and committees. Authenticated members browse, preview, and send them from their own email clients. The platform provides the full content; the member provides the sender identity.

**Key design decisions (spec: `docs/superpowers/specs/2026-06-14-letters-design.md`):**
- **Delivery:** hybrid — "Send from my email" opens a pre-filled `mailto:` link (plain text body) + "Copy rich text" / "Copy addresses" buttons for Gmail/Outlook web paste
- **Data:** 5 new tables (`letter_issue_tags`, `letter_contacts`, `letter_templates`, `letters`, `letter_analytics`) — isolated from all existing schema
- **Templates:** HTML layout wrappers with `{{CONTENT}}` placeholder; must use table layout + inline styles for email client compatibility (Gmail web/mobile, Outlook web/desktop)
- **Issue tags:** admin-managed predefined taxonomy (name + slug); max 10 tags per letter; member filter uses OR semantics
- **Contacts:** searchable database (`mk | minister | committee | custom`); autocomplete with free-form fallback; new contacts saved on submit
- **Draft/publish:** drafts visible to all admins; `lettersEnabled` feature flag gates member view
- **Sorting:** pinned letters always first; then `(priority_weight × 1000 + activity_score) DESC, published_at DESC`
- **Analytics:** per-letter `(letter_id, bucket)` table — same daily+lifetime bucket pattern as `join_analytics`; `{mailto: N, copy: N}` breakdown; no PII
- **Pin notifications:** when admin pins a letter, next poller cycle bundles notification into bill digest (for users getting one) or sends standalone `letter_pin` email to all other members; `pin_notified_at` prevents double-send
- **Admin area:** separate `/admin/letters` route (not inside AdminPanel modal); 4 tabs: Letters, Issue Tags, Contacts, Letter Templates
- **Member area:** dedicated `/letters` page; sidebar filter by issue tag + sort; letter detail is two-column (send panel left, preview iframe right)

## 20. Alliance Guilds & Granular User Access (Priority: Low)

Currently all `allowed_emails` users are a single homogeneous cell. Future work to differentiate access levels:

- **Guild/tier model:** distinguish core cell members from allied organizations or partner groups, each with configurable access scopes (e.g., a guild can view letters but not the parliament tracker, or vice versa)
- **Quick-block mechanism:** admin can suspend a previously-authorized user without deleting them from the allowlist — revokes active refresh tokens immediately without requiring email removal. Useful when someone leaves the group but admin doesn't want to lose the invite history
- **Scope propagation:** gated features (letters, tracker, etc.) check guild membership, not just presence in `allowed_emails`

This is a prerequisite for any cross-organization collaboration feature. Design separately when a specific alliance use case emerges.

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

## 21. Code Review Findings — Rolling (Priority: Low–Medium)

Findings from periodic code review passes (speed, security, performance, storage, UX).
Each is small and independent; promote to its own numbered item if it grows.

### Priority rollup (2026-06-14, after passes 1–7 — all major subsystems reviewed)

Ranked by impact ÷ effort. Detail for each is in the dated pass below.

**Fix now (high leverage, low effort):**
1. ~~**SSRF in `POST /api/summarize`**~~ ✅ **SHIPPED 2026-06-15** — added `requireAuth` + per-IP
   rate limit + `server/services/url-guard.ts` (host allowlist + `ipaddr.js` IP check + redirect
   re-validation + timeout + size cap), applied at the summarizer fetch boundary (covers the
   poller too); plus a relevance-gated, injection-resistant prompt and `[summarizer]` logging.
2. ~~**Index migration**~~ ✅ **SHIPPED 2026-06-15** — migration `0019` adds indexes on
   `refresh_tokens(token_hash,user_id,expires_at)`, `committee_sessions(committee_id)`, and
   `mk_roles`/`mk_activity`/`mk_votes(mk_id)` (declared via schema `index()`).
   (`mk_knesset_terms.mk_id` was already covered by its composite unique.)
3. ~~**Gate deploy on CI**~~ ✅ **SHIPPED 2026-06-15** — `deploy.yml` now has a `test` job
   (lint + `tsc --noEmit` + `npm test`); `build` `needs: test` and `deploy` `needs: build`, so a
   push that fails CI never ships. (All three fix-now items now done.)

**Next (clear value, modest effort):**
4. ~~Resend **batch send** + **crash-safe** notify~~ ✅ **SHIPPED 2026-06-15** — `sendEmailsBatch`
   (`resend.batch.send`, ≤100/request) replaces the sequential 500ms loop for both broadcasts
   (pinned-letter + bill alerts); `notifyPinnedLetters` now stamps `pin_notified_at` only when ≥1
   email actually sent (no more silent "notified" with nothing delivered). Residual: per-recipient
   idempotency (a partial-failure could re-send to already-delivered recipients) would need a
   per-recipient ledger — separate follow-up if needed.
5. ~~**React error boundary** + **dedupe `useFeatureFlags`**~~ ✅ **SHIPPED 2026-06-15** —
   `src/components/ErrorBoundary.tsx` wraps the app in `main.tsx` (RTL fallback + reload instead of
   a white screen); `useFeatureFlags` now shares a module-level cache + single in-flight fetch, so
   all consumers trigger one `GET /api/feature-flags` instead of 3+ per page.
6. ~~**`AbortController` timeouts + retry**~~ ✅ **SHIPPED 2026-06-16** — `server/lib/http.ts`
   `fetchWithTimeout` (15 s `AbortSignal.timeout` + 1 retry on network error / 5xx) wired into the
   three Knesset poll-cycle fetchers (`odata`, `oknesset`, `knesset-scraper`). A hung endpoint no
   longer stalls the loop. (AI path keeps its own handling; Calendly POSTs left unretried.)
7. ~~**`helmet`** + **graceful shutdown**~~ ✅ **SHIPPED 2026-06-16** — `helmet()` (CSP disabled;
   JSON API + inline-styled `/info` HTML) for security headers; SIGTERM/SIGINT handler stops the
   poller (`stopPoller`), drains in-flight HTTP (`server.close`), then closes the DB pool
   (`closeDb`), with a 10s force-exit. **The "Next" tier is now fully cleared** — only
   "Someday / low" items remain.

**Someday / low:**
8. ~~Summarizer re-download short-circuit by URL~~ ✅ **SHIPPED 2026-06-16** (`SummariesRepository.
   getBySourceUrl` + `summarizeUrl` skips the download on a URL hit); ~~N+1 batching in the parliament
   read~~ ✅ **SHIPPED 2026-06-16** (`MksRepository`/`CommitteesRepository.getByIds` batch via
   `inArray`; tracked-list reads went from ~5×N / 2×N queries to a fixed handful);
   ~~admin-letters `getForLetter` N+1~~ ✅ **SHIPPED 2026-06-17** (`getLifetimeForLetters` batches the
   list's analytics into one query); ~~`summaries_cache` prune~~ ✅ **SHIPPED 2026-06-16**
   (poller prunes summaries older than `SUMMARIES_TTL_DAYS`, default 180, each cycle via
   `deleteOlderThan`); ~~`markPinNotified` single-statement~~ ✅ **SHIPPED 2026-06-17**
   (`UPDATE … WHERE id IN`); ~~route-based code splitting~~ ✅ **SHIPPED 2026-06-16** (`React.lazy` for the
   off-home pages + the admin-only `AdminPanel`; main JS chunk 493→432 kB, gzip 155→139);
   ~~broken-image placeholders~~ ✅ **SHIPPED 2026-06-17** (neutral SVG fallback, no more `display:none`);
   ~~role-in-JWT instant-revocation~~ ✅ **SHIPPED 2026-06-17** (`requireAdmin` re-reads role from DB);
   ~~central error handler / 404~~ ✅ **SHIPPED 2026-06-17** (JSON 404 + final error handler in `index.ts`).

   **Still deferred:** `listPublished` tag-filter-to-SQL + pagination (in-memory fine at current scale);
   flag-gate flash (largely mitigated by the `useFeatureFlags` dedup); poller-in-web-process split
   (deployment-topology change, unneeded now).

### 2026-06-14 — Review pass 1: server read paths + frontend bundle

- **[Performance] N+1 in the parliament read (hot path).** `TrackedMksRepository.getAll`
  and `TrackedCommitteesRepository.getAll` loop over tracked rows and call `getById` per
  entity (`server/repositories/tracked-mks-repository.ts:13`, `tracked-committees-repository.ts:13`),
  and `getById` itself fans out (MK row + faction history + annotations; committee + sessions).
  Tracking N entities ⇒ N×several queries on every `GET /api/parliament/:type`. Fine at the
  current cell size; fix by batching with `inArray(...)` + in-memory grouping (one query per
  table). Same shape in `CommitteesRepository.getAll` (`:71`, one sessions query per row).
- **[Performance] N+1 in admin letters list.** `admin-letters.ts:23` runs
  `analyticsRepo.getForLetter(id)` per letter. Batch into a single grouped query over
  `letter_analytics`. Admin-only, low cardinality — low urgency.
- **[Performance] `LettersRepository.listPublished` filters & sorts all published rows in
  memory** (`letters-repository.ts:31`) with no SQL tag filter or LIMIT. Push the tag filter
  into SQL and paginate when letter volume grows.
- **[Performance/minor] `markPinNotified` issues one UPDATE per id** (`letters-repository.ts:126`).
  Collapse to a single `UPDATE … WHERE id IN (…)`.
- **[Speed/UX] Frontend ships a single ~492 KB JS chunk** (154 KB gzip; no route splitting).
  The admin panel, admin-letters, letters, and constitution pages all load on first paint.
  Use `React.lazy` + `Suspense` for the off-home routes to cut initial JS for the common
  (homepage) visitor.

### 2026-06-14 — Review pass 2: poller + external Knesset API

- **[Performance/storage/cost] Summarizer re-downloads every document each poll cycle.**
  `Summarizer.summarizeUrl` (`server/services/summarizer.ts:54`) fetches the full PDF/DOCX,
  then keys the cache by MD5 of the downloaded buffer (`:43`). So even when the summary is
  cached, `pollBills` (`poller.ts:91`) re-downloads every bill's document every cycle (6 h)
  just to compute the hash and hit the cache. Short-circuit by URL — e.g. a `url → md5` (or
  `url → summary`) lookup, or skip re-summarizing when the bill already has a summary and the
  doc URL is unchanged. Saves bandwidth + cycle time.
- **[Speed/resilience] External `fetch()` calls have no timeout/abort.** Neither the Knesset
  OData layer (`knesset-bills.ts`) nor the summarizer set an `AbortController` deadline, so a
  hung endpoint stalls the (sequential) poll loop indefinitely. The poller only backs off on
  *total* failure. Add a per-request timeout (AbortController) and a small retry to all
  outbound fetches.
- **[Speed, trade-off] Poll loops are fully sequential.** `pollBills`/`pollCommittees`/
  `pollMks` await one external round-trip per entity (`poller.ts:74,122,165`); cycle time
  grows linearly with tracked-entity count. Bounded concurrency (e.g. p-limit 3–5) would cut
  wall-clock time — but weigh against Knesset API politeness/rate-limits; keep concurrency low
  and jittered. Document the chosen limit.

### 2026-06-14 — Review pass 3: auth & middleware / security surfaces

- **[Security — SSRF, high] `POST /api/summarize` fetches an arbitrary caller-supplied URL,
  unauthenticated.** The route (`server/routes/summarize.ts`) takes `{ url }` and calls
  `summarizer.summarizeUrl(url)` → `fetch(url)` server-side with no auth, no host allowlist,
  no private-IP guard, no rate limit. An attacker can point it at internal services or cloud
  metadata (e.g. `http://169.254.169.254/…`) and also burn Claude/bandwidth. Fix: gate with
  `requireAuth`; allowlist hosts (knesset.gov.il / oknesset / known doc hosts); reject
  private/loopback/link-local targets after DNS resolution; add rate limiting. The poller's
  own use passes trusted Knesset URLs, so locking the public route down is safe.
- **[Security] Rate limiting is applied to only one route.** `SlidingWindowLimiter`
  (`server/services/rate-limit.ts`) is used solely by the meetings booking-link endpoint.
  `POST /api/auth/google` and `/api/auth/refresh` (brute-force / token-verification abuse),
  `/api/summarize`, and `/api/admin/letters/beautify` (cost) have none. Apply the limiter to
  auth endpoints (per-IP) and the expensive AI/download endpoints.
- **[Security/auth — note] Access token carries `role` in the JWT.** `requireAdmin` trusts the
  role claim (`server/middleware/auth.ts`), so a demoted admin keeps admin rights until the
  15-min access token expires (refresh re-reads the DB role). Acceptable given short TTL, but if
  instant revocation is ever needed, check the role against the DB in `requireAdmin` or shorten
  the access TTL. Pairs with the quick-block idea in §20.

### 2026-06-14 — Review pass 4: frontend UX / accessibility / client perf

- **[Performance] `useFeatureFlags` refetches per component instance.** The hook holds its own
  `useState` + `fetch` (`src/hooks/useFeatureFlags.ts`), and the homepage mounts it 3× (Header,
  MeetUsSection, useBillsOverview) — plus LettersPage/AdminLettersPage — firing identical
  `GET /api/feature-flags` requests in parallel with no shared cache. Hoist to a context
  provider (fetch once, share) or a module-level/SWR cache.
- **[UX/resilience] No React error boundary.** There is no `ErrorBoundary` anywhere, so a single
  render-time throw (e.g. in the parliament drawer or a letters page) white-screens the entire
  SPA. Add a top-level boundary with a friendly RTL fallback + reload action; optionally wrap the
  parliament tracker separately so a tracker error doesn't take down the homepage.
- **[UX/minor] Flag-gated content flashes on load.** `useFeatureFlags` returns `{}` until the
  fetch resolves, so flag-gated UI (letters nav link, Meet-Us section, bills-overview tabs)
  briefly renders hidden then pops in. Fixed largely by the dedup/cache item above; consider a
  brief loading state for gated sections.
- **[UX/nit] Broken images vanish silently.** `onError` handlers set `display:none` on `<img>`
  (MkCard, GallerySection, AboutSection) — a failed photo leaves an empty gap rather than a
  placeholder/initials avatar. Low priority.
- *(Checked, OK: all `<img>` have meaningful `alt`; combobox/icon buttons mostly have visible
  text or labels — no broad a11y gap found this pass.)*

### 2026-06-14 — Review pass 5: database schema, indexes & storage

Postgres auto-indexes only PKs and unique constraints — **not** foreign keys. The schema
(`server/db/schema/*.ts`) defines no explicit secondary `index()`. Several hot lookup columns
are therefore unindexed (sequential scans):

- **[Performance, high] `refresh_tokens.token_hash` is unindexed.** Every `/api/auth/refresh`
  runs `findRefreshToken(hash)` → `WHERE token_hash = …`, a full scan of `refresh_tokens` on the
  hottest auth path (per active session, ~every 15 min), and the table accumulates rows from
  rotation. Make it `.unique()` (also enforces no-collision) or add an index. Add indexes on
  `user_id` (reuse-detection delete) and `expires_at` (poller cleanup) too.
- **[Performance] `committee_sessions.committee_id` is unindexed.** Read per committee in
  `CommitteesRepository.getById/getAll` and every poll cycle → seq scan of all sessions per
  committee. Add an index.
- **[Performance] MK child tables' `mk_id` is unindexed** — `mk_knesset_terms`, `mk_roles`,
  `mk_activity`, `mk_votes` (`server/db/schema/mks.ts`). The MK read reassembles these per MK
  (compounds with the N+1 from pass 1). Add a `mk_id` index on each.
- **[Storage] `summaries_cache` has no prune/TTL.** Keyed by document MD5, it grows unbounded as
  bills/committee docs change. Add an age- or size-based prune (the storage-pressure framework in
  §10 could own it).
- *(Checked, OK: tracking tables already carry composite `unique(user_id, …)` constraints, so the
  per-user parliament read is index-covered — no gap there.)*

Suggested single migration: add the indexes above (`CREATE INDEX CONCURRENTLY` in prod) — small,
high-leverage, no app changes.

### 2026-06-14 — Review pass 6: email / notifications subsystem

The email service (`server/services/email.ts`) is solid — lazy client, address redaction in
logs, a `sent_emails` ledger, never-throws contract. Findings are about broadcast scale and
crash-safety:

- **[Performance] Broadcasts send sequentially with a 500 ms gap.** `sendEmailsThrottled`
  (`email.ts`) loops one `sendEmail` at a time spaced 500 ms apart, so a notification to N
  members takes ~N×500 ms (100 members ≈ 50 s) — and it runs inside the poll cycle
  (`notifyPinnedLetters`, `sendBillAlerts`), blocking it. Switch broadcasts to Resend's batch
  API (`resend.batch.send`, up to 100/call with per-message html) to cut wall-clock and
  round-trips.
- **[Correctness/UX] Broadcasts aren't crash-safe → duplicate emails.** `notifyPinnedLetters`
  (`server/services/letter-notifier.ts`) calls `sendEmailsThrottled(...)` and only then
  `markPinNotified(...)`. If the process dies mid-broadcast, the next cycle re-sends to
  *everyone*, including those already emailed. Bill alerts have the same shape. Track
  per-recipient delivery, or stamp state before sending and reconcile, to make re-runs
  idempotent.
- **[Resilience] No retry on transient send failure.** A failed `resend.emails.send` is recorded
  `failed` and dropped — a blip loses an invite/alert permanently. Add a bounded retry
  (exponential backoff) or a small retry queue drained by the poller off the `sent_emails`
  ledger.
- *(Checked, OK: `sent_emails` ledger is pruned under storage pressure via `SENT_EMAIL_PURGE_BATCH`
  (§10); delivery-status polling is capped by `EMAIL_STATUS_POLL_CAP`.)*

### 2026-06-14 — Review pass 7: server bootstrap / HTTP hardening / CI

- **[CI/CD, high-ish] Deploy is not gated on tests.** `ci.yml` runs lint + `tsc --noEmit` +
  `npm test` + build on push/PR, but `deploy.yml` is a *separate* workflow that fires on the same
  push and only runs `vite build` before deploying. So code that fails lint/typecheck/tests still
  ships as long as `vite build` compiles (this is how a type-only break slipped past `tsc --noEmit`
  earlier — caught only because `tsc -b` runs in the build). Gate deploy on CI: have `deploy.yml`
  `needs:` the CI job (reusable workflow / `workflow_run`) or run the full `npm test` in deploy.
- **[Security] No security headers (`helmet`).** `server/index.ts` mounts `cors` + `express.json`
  but no `helmet`, so responses lack `X-Content-Type-Options`, `Referrer-Policy`, HSTS, frame
  protections. Cheap defense-in-depth — add `helmet()` early in the middleware chain.
- **[Resilience] No graceful shutdown.** No `SIGTERM`/`SIGINT` handler. On every Render redeploy
  the process is killed without stopping the poller, draining in-flight requests, or closing the
  node-postgres pool — risking a truncated poll-cycle write or dropped connections. Add a handler
  that stops the listener + poller and `await pool.end()`.
- **[Resilience/minor] No central Express error handler or JSON 404.** Routes catch their own
  errors, but an unexpected throw in middleware (e.g. the CORS callback) has no centralized
  handler, and unknown `/api/*` paths fall through. Add a final `(err,req,res,next)` JSON error
  handler + 404 to avoid leaking defaults.
- **[Architecture/scaling — note] The poller runs in the web process.** `startPoller()` shares the
  event loop with request serving, so a heavy cycle (many sequential external fetches, pass 2) adds
  latency to API requests. Fine on one small instance; if load grows, split the poller into a
  separate Render worker/cron service.
- *(Checked, OK: `express.json()` keeps the default 100 kb body cap; CORS allow-no-origin is
  intentional and not an auth boundary since auth is JWT.)*

## 22. Civic Letters — Usability v2 (Priority: Medium)

The Civic Letters system (§19) works but feels heavy. The DB and the mailto/Gmail URL
builders (`server/services/letter-utils.ts`) already support multiple recipients and a full
address book (`letter_contacts`); the gaps are in the UI, in seeding, and in transparency.
Items below are scoped to be as independent as possible.

**Tracks / parallelism:** §22.3 (privacy notice) and §22.4 (seed address book) touch disjoint
files and are safely parallelizable. §22.1, §22.2, §22.5, §22.6 all edit
`src/pages/AdminLettersPage.tsx` / `LetterDetailPage.tsx` and should run as one sequential
owner to avoid collisions. Suggested order: **22.3 ∥ 22.4**, then **22.1 → 22.6 → 22.2 → 22.5**.

### 🔲 Open — 22.1 Multi-recipient composer (To/Cc/Bcc) with address-book picker
Replace the single To email/name pair in the admin composer with To/Cc/Bcc multi-recipient
editors. Each row is picked from the address book (searchable, via existing
`GET /api/admin/letters/contacts?q=`) or typed free-form; persist into the existing
`toAddresses/ccAddresses/bccAddresses` JSONB arrays (carry `contact_id` when picked). No
schema change — the arrays and URL builders already handle many recipients.
Files: `src/pages/AdminLettersPage.tsx`; `src/lib/api-client.ts` (contacts-search helper if
not already exposed).

### 🔲 Open — 22.2 Members can add/remove their own recipients before sending
On `/letters/:id`, let members add/remove recipients (address book or free-form) on top of
the admin presets, then send. `mailtoUrl`/`gmailUrl` are currently built server-side in the
detail response, so move/duplicate URL construction to the client (or add an endpoint that
accepts extra recipients) so links reflect member edits. Admin presets remain the default set.
Files: `src/pages/LetterDetailPage.tsx`; client-side mailto/Gmail builders (port from
`server/services/letter-utils.ts`); read-only contacts access for members.

### 🔲 Open — 22.3 Privacy/transparency notice: sends are counted anonymously
Add a clear Hebrew-first notice on the letters list and detail pages: sends are counted in
aggregate only; the platform does **not** record who sent which letter. This is truthful —
`letter_analytics` stores only `(letterId, action)` with no `user_id`.
Files: `src/pages/LettersPage.tsx`, `src/pages/LetterDetailPage.tsx`, locale files. Small
isolated component. *(Parallelizable.)*

### 🔲 Open — 22.4 Seed the address book (ministries + MKs + committees)
Pre-populate `letter_contacts` so recipients aren't typed by hand:
- **Ministries:** new curated `scripts/seed-data/ministry-contacts.json` (official gov.il
  public contact emails) → `category='ministry'`.
- **MKs:** reuse emails already in `scripts/seed-data/mks.json` / `KNS_Person.Email` → `category='mk'`.
- **Committees:** `KNS_Committee.Email` (available via OData) → `category='committee'`.
Make seeding idempotent (unique `email`); decide one-time seed vs. periodic top-up. Add a
`category` filter to the contacts picker so the book is browsable by group.
Files: `scripts/seed-data/ministry-contacts.json` (new), seed script,
`server/repositories/letter-contacts-repository.ts` (bulk upsert), contacts picker. *(Parallelizable.)*

### 🔲 Open — 22.5 Composer usability pass (reduce heaviness)
After 22.1 lands, tighten the admin composer: clearer layout/grouping, live template preview
while editing, fewer clicks to publish, inline feedback. Stay within the current single-page
form; no new framework.
Files: `src/pages/AdminLettersPage.tsx`. Do last (depends on 22.1 layout).

### 🔲 Open — 22.6 (bug) Composer doesn't refresh contacts/templates after creation
After creating a contact or template in another admin tab, the composer's pickers don't show
it until reload (lists load on mount and never refetch). Refetch / lift to shared state /
invalidate the contacts and templates lists when the composer opens or after a successful
create elsewhere.
Files: `src/pages/AdminLettersPage.tsx`.

## 23. Database — Group Tables into Domain Schemas (Low Coupling / High Cohesion) (Priority: Low)

All 28 tables currently live in one Postgres `public` schema on Neon. They already cluster by
domain at the Drizzle file level (`server/db/schema/*.ts`), but that grouping isn't expressed
in the database. Promote each cohesive cluster to its own **Postgres schema** (namespace) so
tables that change together live together, cross-domain references are explicit and minimized,
and per-domain access/permissions become possible.

**Proposed schema → tables mapping:**
- `parliament` — `bills`, `committees`, `committee_sessions`, `mks`, `mk_activity`,
  `mk_knesset_terms`, `mk_roles`, `mk_votes`, `mk_annotations`, `tracked_bills`,
  `tracked_committees`, `tracked_mks`, `knesset_members_cache`, `knesset_committees_cache`,
  `summaries_cache`, `knesset_config`
- `auth` — `users`, `refresh_tokens`, `allowed_emails`
- `email` — `email_templates`, `sent_emails`
- `letters` — `letters`, `letter_contacts`, `letter_issue_tags`, `letter_templates`
- `analytics` — `join_analytics`, `letter_analytics`
- `config` — `feature_flags`

Per-user **tracking** tables fold into `parliament` (not a separate schema) so
`tracked_* → bills/committees/mks` stay intra-schema. **Caches** live in the domain they cache
(`knesset_*_cache` + `summaries_cache` → `parliament`) rather than a shared `cache` schema, and
`knesset_config` joins `parliament` as knesset-domain state. **All analytics** consolidate under
`analytics` (`join_analytics` + `letter_analytics`) for a single analytics surface.

**Coupling notes (the point of the exercise):** after the above, the only cross-schema FKs are
`parliament.tracked_* → auth.users`, `letters.letters.created_by → auth.users`, and
`analytics.letter_analytics → letters.letters`. Everything else is intra-schema. Postgres supports
cross-schema FKs fine; the goal is to make those few links explicit and keep the rest local.

**Feasibility — VERIFIED (2026-06-18 spike):** the make-or-break risk (does the test driver
support schema DDL?) is cleared. A pglite 0.4.6 spike confirmed `CREATE SCHEMA`,
`ALTER TABLE … SET SCHEMA`, **cross-schema FKs preserved + enforced**, and cross-schema JOINs all
work; after a move an unqualified `SELECT … FROM <t>` correctly fails (proving Drizzle must emit
schema-qualified SQL — which `pgSchema()` does). Code audit also confirmed **no raw SQL hardcodes a
table name in any query** (only `pg_database_size(current_database())`, schema-independent), so
moving tables auto-qualifies every repository query — zero repo changes. Neon (Postgres 17) supports
all of the above trivially. Remaining fiddly step is reconciling Drizzle's `meta/*_snapshot.json` to
the new `pgSchema` declarations after hand-writing the move migration. One ordering trap: the raw
`INSERT INTO letter_contacts` in `0020_seed_letter_contacts.sql` is unqualified, so the schema-move
migration must be a later index (runs after, when the table is already moved is irrelevant since
0020 runs first while still in `public`) — and any *future* raw SQL must schema-qualify.

**Implementation considerations:**
- Drizzle: declare each group via `pgSchema('parliament').table(...)` instead of `pgTable(...)`;
  Drizzle then emits schema-qualified DDL/queries, so repositories that reference table objects
  need no change. Audit any **raw SQL** in migrations (`server/db/migrations/*.sql`) and services
  for unqualified table names.
- Migration: `CREATE SCHEMA IF NOT EXISTS ...` then `ALTER TABLE <t> SET SCHEMA <s>` for each
  table (cheap metadata-only move; FKs/indexes follow). Sequence so dependents move with/after
  their parents. Must run cleanly via the existing startup migration runner against Neon.
- Connection: either set the `node-postgres` pool `search_path` to include all schemas, or rely
  on Drizzle's full qualification (preferred — no implicit search_path dependence).
- Update `npm run db:seed` / `scripts/seed-data` loading and any pglite test setup so the schemas
  exist before seeding; run the full suite.

**Cost/benefit:** this is organizational, not behavioral — payoff is clarity, enforceable
per-domain permissions, and a schema map that documents the coupling. For an app this size it's
optional polish; do it when touching the data layer anyway, and as one atomic migration (don't
leave tables half-migrated across schemas). Verify: `npx tsc --noEmit` && `npm test` &&
`npm run build`, plus a migration dry-run against a scratch Neon branch before production.

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
