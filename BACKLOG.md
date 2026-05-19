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

## 4. MK Card — Submitted Bills and Parliamentary Queries (Priority: Medium)

Expand the MK card to surface legislative activity:

- **Submitted bills:** bills the MK personally submitted or co-sponsored, fetched from the Knesset API
- **Parliamentary queries (שאילתות):** questions the MK submitted to ministers, with date and subject
- Displayed as a collapsible/expandable section inside the card — collapsed by default
- Each item links out to the official Knesset record

**Notes:**
- Data should be fetched via the existing `/api/parliament` backend route rather than hard-coded

## 5. API Layer — Centralize All API Calls per Module (Priority: Medium)

All API calls should go through a dedicated API layer inside each module.

**Requirements:**
- Each feature module has its own `api.ts` file that owns all fetch calls for that domain
- Components and hooks import from the API layer only — no raw `fetch`/`axios` calls in components
- The API layer is the single place to set base URLs, headers, error handling, and response shaping
- Backend route files follow the same pattern: routes call services only, no direct Knesset API calls in handlers

## 6. Closed Committees — Auto-Remove from All Views (Priority: Medium)

When a Knesset committee is closed/dissolved, it should be removed from the UI everywhere it appears.

**Requirements:**
- Committee data includes an `active` boolean (or a `closedDate` field) sourced from the Knesset API
- Any component that lists or references committees filters out inactive ones
- Protocols and MK cards that reference a now-closed committee display the committee name as plain text (historical record) rather than a selectable/linked item
- The backend poller should keep committee status up to date

## 7. Knesset Transition — Handle Dispersal and New Knesset Election (Priority: Medium)

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

## 8. Media Migration — Fetch Event Photos from likudliberal.org (Priority: Medium)

The old site at likudliberal.org contains event photos and media that are missing from the new site. These should be scraped and migrated before the old site is decommissioned or goes dark.

**Requirements:**
- Crawl likudliberal.org and extract all image URLs (event photos, gallery content, etc.)
- Download and store images in cloud storage (Cloudflare R2 or equivalent)
- Preserve metadata where available: event name, date, caption, original URL
- Output a structured manifest (JSON) mapping each image to its metadata, ready to feed into the CMS
- Do not migrate unrelated UI assets — focus on event/content photos

**Notes:**
- Do this before the old site changes — media on the old site may disappear without warning
- The scrape should be a one-time migration script, not an ongoing sync

## 9. Upgrade Node.js Version (Priority: Low)

The current runtime is Node v21.7.3 (an odd/non-LTS release). Upgrade to the latest LTS version.

**Requirements:**
- Upgrade to the latest Node LTS (v22.x at time of writing)
- Add an `.nvmrc` or `engines` field in `package.json` to pin the expected version
- Verify all dependencies (Vite, tsx, Express) are compatible after the upgrade
- Update CI/CD pipeline to use the same LTS version

## 10. Live Parliamentary Content Translation (Priority: Low)

Parliamentary content items (bill titles, MK names, committee names, activity descriptions) are stored as plain Hebrew strings from the Knesset API. No English source exists.

**Requirements:**
- Each parliamentary data item carries a stable identity (its Knesset numeric ID)
- A translation cache maps `{ id → { he: string, en: string } }` — stored alongside the existing JSON data
- On first English-mode view, translations are requested (via LLM or translation API) and written to the cache
- Components check the cache before falling back to the raw Hebrew string
- The cache is persisted between server restarts
- Depends on: item 2 (database) for long-term cache storage

## 11. CommitteeCard — Recent Sessions with Links (Priority: Medium)

Display the committee's last 3–5 session dates and links directly inside the `CommitteeCard`.

**Requirements:**
- Fetch recent sessions from Knesset OData at poll time
- Store sessions as a `recentSessions` array on the `Committee` type: `{ date: string; sessionId: number; sessionUrl: string; type: string }[]`
- `CommitteeCard` renders each session as a dated link: `"13/05/2026 — פתוחה ↗"`
- Links point to the canonical Knesset session URL from OData's `SessionUrl` field

## 12. Poller — Backoff on Failure (Priority: High)

On fetch failure the poller currently retries immediately, causing a tight loop of constant GET requests to the Knesset API.

**Requirements:**
- On any failed poll cycle, wait a minimum backoff interval before the next attempt (e.g. 60 seconds, increasing exponentially up to a cap like 10 minutes)
- A successful cycle resets the backoff to the normal poll interval
- Errors are logged with the backoff duration
- The fix applies to all polled lists: MKs, committees, bills

**Notes:**
- Current observed behavior: a single failure causes the poller to hammer the Knesset API continuously, which risks rate-limiting or IP blocking

## 13. Shareable Language Links — `?lang=en` URL param (Priority: Low)

Add `?lang=en` query param support so language-specific URLs can be shared and bookmarked.

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
