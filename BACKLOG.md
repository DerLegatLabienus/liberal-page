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

## 3. Multi-Language Support (Priority: Low)

### 3a. Shareable language links (Priority: Low)

After i18n is shipped, add `?lang=en` query param support so language-specific URLs can be shared and bookmarked. On load, read `?lang=` before `localStorage` and set language accordingly. Enables sharing an English-language URL with diaspora audiences.

Depends on: item 3 (i18n) shipping first.



Add an English (LTR) version of the site. `useDirection()` already observes
`document.documentElement.dir` — switching the attribute flips all directional
components automatically.

## 4. User Accounts & Alerts (Priority: Low)

Member login, personalized tracking lists, email alerts on bill status changes.
Requires database (item 2 above) and an email service.

## 5. MK Selection — Combobox Instead of Link (Priority: Medium)

Replace the current link-based MK navigation with a combobox (searchable dropdown). Users should be able to type or select an MK name from the dropdown to switch the active MK card view, rather than clicking through links.

**Requirements:**
- Combobox with search/filter as the user types
- Lists all MKs from the representatives data
- Selecting an MK updates the displayed card immediately
- Accessible (keyboard navigable, ARIA combobox role)
- Each MK entry in the combobox displays an icon if they are a "friend of the Likud liberals" (an ally outside the cell who supports liberal positions)
- New boolean field `liberalFriend` on the `Representative` type to drive the icon
- Icon should be visually distinct and carry a tooltip/label explaining the designation

## 6. MK Card — Submitted Bills and Parliamentary Queries (Priority: Medium)

Expand the MK (Member of Knesset) card to surface the legislative activity of each representative:

- **Submitted bills:** bills the MK personally submitted or co-sponsored, fetched from the Knesset API (the backend already has `knesset-api.ts` and `oknesset.ts` services)
- **Parliamentary queries (שאילתות):** questions the MK submitted to ministers, with date and subject
- Displayed as a collapsible/expandable section inside the card — collapsed by default to keep the list compact
- Each item links out to the official Knesset record

**Notes:**
- Data should be fetched via the existing `/api/parliament` backend route rather than hard-coded
- Keeps the MK card as the single place to understand a representative's track record

## 7. API Layer — Centralize All API Calls per Module (Priority: Medium)

All API calls should go through a dedicated API layer inside each module rather than being called directly from business logic or components.

**Requirements:**
- Each feature module (bills, representatives, protocols, updates, etc.) has its own `api.ts` file that owns all fetch calls for that domain
- Components and hooks import from the API layer only — no raw `fetch`/`axios` calls in components, hooks, or service logic
- The API layer is the single place to set base URLs, headers, error handling, and response shaping
- Backend route files follow the same pattern: no direct Knesset API calls inside route handlers — those belong in the existing `services/` files, and routes call services only

**Why:** Keeps business logic testable and decoupled from transport details. Swapping endpoints, adding auth headers, or mocking in tests requires changing one file per domain, not hunting through components.

## 8. Bill Selection — Combobox for New Bills, Link Fallback for Older Items (Priority: Medium)

New bills should be added and navigated via a searchable combobox. Older bills that already have a direct URL (e.g. a Knesset page link) should continue to be accessible via that link.

**Requirements:**
- Combobox to search and select a bill by number or title — replaces any direct-link navigation for new bills
- New field `knessetUrl` on the `Bill` type (optional) — when present, renders a link to the official Knesset record alongside the card
- Bills without a `knessetUrl` (older or manually entered items) show no link — no broken placeholders
- Combobox and link coexist: the combobox drives in-app navigation/selection; the link opens the external record in a new tab

## 9. Knesset Committee Selection — Combobox Instead of Link (Priority: Medium)

Knesset committees should be selected via a searchable combobox rather than navigated by link.

**Requirements:**
- Combobox lists all Knesset committees (sourced from the existing backend/Knesset API data)
- Selecting a committee filters or displays the relevant content (protocols, MKs, bills associated with that committee)
- Replaces any direct link-based committee navigation throughout the site
- Accessible (keyboard navigable, ARIA combobox role)
- Closed committees are excluded from the combobox and from all committee displays — they should not appear anywhere once marked closed

## 10. Closed Committees — Auto-Remove from All Views (Priority: Medium)

When a Knesset committee is closed/dissolved, it should be removed from the UI everywhere it appears — not just the combobox.

**Requirements:**
- Committee data includes an `active` boolean (or a `closedDate` field) sourced from the Knesset API
- Any component that lists or references committees filters out inactive ones
- Protocols and MK cards that reference a now-closed committee display the committee name as plain text (historical record) rather than a selectable/linked item
- The backend poller should keep committee status up to date

## 11. Knesset Transition — Handle Dispersal and New Knesset Election (Priority: Medium)

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

## 12. Media Migration — Fetch Event Photos from likudliberal.org (Priority: Medium)

The old site at likudliberal.org contains event photos and media that are missing from the new site. These should be scraped and migrated before the old site is decommissioned or goes dark.

**Requirements:**
- Crawl likudliberal.org and extract all image URLs (event photos, gallery content, etc.)
- Download and store images in cloud storage (Cloudflare R2 or equivalent)
- Preserve metadata where available: event name, date, caption, original URL
- Output a structured manifest (JSON) mapping each image to its metadata, ready to feed into the CMS (item 1 in backlog)
- Do not migrate unrelated UI assets (logos used purely for layout, icons, etc.) — focus on event/content photos

**Notes:**
- Do this before the old site changes — media on the old site may disappear without warning
- The scrape should be a one-time migration script, not an ongoing sync
- Review images manually after download to discard duplicates or low-quality shots before importing into CMS

## 13. Upgrade Node.js Version (Priority: Low)

The current runtime is Node v21.7.3 (an odd/non-LTS release). Upgrade to the latest LTS version for long-term support, security patches, and compatibility with current tooling.

**Requirements:**
- Upgrade to the latest Node LTS (v22.x at time of writing)
- Add an `.nvmrc` or `engines` field in `package.json` to pin the expected version and prevent accidental mismatches
- Verify all dependencies (Vite, tsx, Express) are compatible after the upgrade
- Update CI/CD pipeline (item T3) to use the same LTS version

## 12. Live Parliamentary Content Translation (Priority: Low)

Parliamentary content items (bill titles, MK names, committee names, activity descriptions) are stored as plain Hebrew strings from the Knesset API. No English source exists.

**Requirements:**
- Each parliamentary data item carries a stable identity (its Knesset numeric ID)
- A translation cache maps `{ id → { he: string, en: string } }` — stored alongside the existing JSON data
- On first English-mode view, translations are requested (via LLM or translation API) and written to the cache
- Components check the cache before falling back to the raw Hebrew string
- The cache is persisted between server restarts
- Depends on: item 3 (i18n) shipped first, item 2 (database) for long-term cache storage
