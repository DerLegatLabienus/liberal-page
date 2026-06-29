# Component Reference

Current components live under `src/components/`. Styling is Tailwind-based, with shadcn-style primitives in `src/components/ui/`. There are no current `.module.css` component styles.

## App Composition

`HomePage` (`src/pages/HomePage.tsx`) composes the homepage as a funnel —
identity → join → tracker → gallery:

| Component | Purpose |
|-----------|---------|
| `layout/Header` | Sticky nav, logo, Knesset drawer trigger, new-data badge |
| `sections/HeroSection` | Headline + tagline; one primary CTA (Join) and a secondary Constitution link |
| `sections/HomePanels` | Auto-scrolling horizontal carousel of: Who we are · Our MKs · FAQ · Meet us · Gallery |
| `sections/JoinSection` | Join selector and secure handoff to effective-soft |
| `sections/KnessetSection` | Hebrew-only: tracked strip teaser + all-bills overview in one section |
| `layout/Footer` | Footer content |
| `layout/ParliamentDrawer` | Side drawer for tracked bills, committees, and MKs |

`HomePanels`, `KnessetSection` compose smaller **content blocks** —
`AboutSection`, `LiberalsShowcase`, `FaqSection`, `MeetUsSection`, `GallerySection`
(in the carousel) and `ParliamentStrip`, `KnessetBillsOverview` (in the Knesset section).
Those blocks no longer render their own `<section>` shell; their wrappers own the
section element, background, and padding.

## Layout Components

### `Header`

Reads `site.json` for logo and party name. The nav links are `#about` and `#join`. (FAQ and Gallery have no standalone anchors — they are panels inside the `#about` `HomePanels` carousel.)

The "מעקב כנסת" button opens the drawer. If any bill, committee, or MK has `hasNewData: true`, the button shows a blue dot badge. The current implementation computes the badge but does not clear `hasNewData` when the drawer opens.

`AuthControl` is embedded in the header (right side on desktop, bottom of the mobile menu). See the "Admin & Auth Components" section below.

### `ParliamentDrawer`

Full-height side sheet. It opens from the right in RTL and left in LTR using `useDirection()`.

The drawer contains:

- `AddTrackingInput`
- Tabs for `bills`, `committees`, and `mks`
- `BillCard`, `CommitteeCard`, and `MkCard` lists
- A footer with the latest frontend sync timestamp and manual refresh button

The drawer receives all data and remove callbacks from `App.tsx`.

### `Footer`

Renders simple site footer content using `site.json`.

## Section Components

### `HeroSection`

Headline + tagline. One primary CTA (Join, anchors to `#join`) and a secondary
Constitution text-link to `/constitution`. Takes no props (the tracker CTA was
removed — it still lives in the header).

### `HomePanels`

The identity cluster as a horizontally-snapping carousel (owns `id="about"`). Full-width
panels with scroll-snap, prev/next arrows (desktop) and clickable dots. Panels:

1. **Who we are** — `AboutSection`
2. **Our MKs** — `LiberalsShowcase` (included only when at least one MK is annotated)
3. **FAQ** — `FaqSection`
4. **Meet us** — `MeetUsSection` (included only when `meetUs` flag on and visitor anonymous)
5. **Gallery** — `GallerySection` with `maxItems={4}` (keeps the panel short on mobile; lightbox still cycles all images)

Visibility for the conditional panels is computed in `HomePanels` (via `useMkList`,
`useFeatureFlags`, `useAuthOptional`) so the dot/arrow count tracks the visible panels.
Active panel is tracked on scroll by nearest-centre (direction-robust for RTL); arrows
use logical `start`/`end` positioning and direction-aware chevrons.

**Auto-scroll:** advances to the next panel every `AUTO_ADVANCE_MS` (6s), wrapping at the
end. Paused on hover and focus-within, and disabled when the user prefers reduced motion.
The dwell timer re-arms whenever the active panel changes, so a manual nav restarts it.

### `KnessetSection`

Hebrew-only wrapper composing `ParliamentStrip` (tracked-items teaser) above
`KnessetBillsOverview` (browse all bills) in one section. Receives bills, committees,
`onOpenDrawer`, and an optional `error`/`onRetry` for the load-failure banner.

### `ParliamentStrip`

Content block (no section shell). Receives bills and committees. Shows active bills,
committees, and a button that opens the full drawer.

Cards use `flex-wrap` so they wrap on narrow screens rather than causing horizontal scroll. Bill and committee cards have `min-w-[150px] sm:min-w-[180px]`. The "more" button is `w-full sm:w-auto` — full-width on mobile, auto on larger screens.

### `AboutSection`

Content block (no section shell). Reads `about.json`. Renders the first two paragraphs,
values, and optional leadership items if present.

### `GallerySection`

Content block (no section shell). Reads `gallery.json` and renders image cards with captions and dates, plus the lightbox dialog. Rendered as the last panel inside `HomePanels`.

### `FaqSection`

Content block (no section shell). Reads `faq.json` and renders an accordion. Rendered as a panel inside `HomePanels`.

### `JoinSection`

Renders the local join selector and explains that the official form opens in effective-soft.

The selector does not collect or submit personal data. It only chooses the correct external effective-soft URL.

### `MeetUsSection`

Outreach section for **anonymous visitors** (e.g. politicians wanting to meet the cell). Hidden for signed-in members (they are the hosts) and when the `meetUs` feature flag is disabled.

Flow: visitor clicks "Continue with Google" → Google One Tap verifies identity → `POST /api/meetings/booking-link` checks for an existing active meeting → returns a single-use Calendly link → Calendly popup opens prefilled with the visitor's name/email → on `calendly.event_scheduled` message, shows a confirmation state. Repeat attempts before the meeting passes surface cancel/reschedule links from the 409 response.

No data is persisted on our side. Configuration: `CALENDLY_API_TOKEN` env var + `meetUs` feature flag value = Calendly event-type URI (set via admin panel).

## Admin & Auth Components

### `AuthControl`

Lives in the sticky header (right side). Renders nothing until the auth session is restored (`ready = true`).

- **Logged out:** Google sign-in button (`@react-oauth/google`). `VITE_GOOGLE_CLIENT_ID` must be set for the button to function; sign-in errors report invite-gate (`403`) vs. generic failure via toast.
- **Logged in:** user name/email, email-alerts checkbox, sign-out button. Admins additionally see the "Admin" link that opens `AdminPanel`.

### `AdminPanel`

Modal dialog for admin-only site management. Opened from `AuthControl`; always `dir="rtl"` (internal Hebrew-first tool). All labels are in English regardless of the active site language.

Loads all data in parallel on open (`listInvites`, `listUsers`, `emailTemplates.list`, `featureFlags.get`, `analytics.joinSummary`). Has five sections:

| Section | What it does |
|---------|-------------|
| **Invites** | Add an email + role to the allowlist; list and remove existing invites. Adding fires an invitation email via Resend. |
| **Users** | List all registered users; toggle admin ↔ member (self-toggle disabled). |
| **Email templates** | Accordion — one item per template (`invite`, `bill_digest`, etc.). Each item has a subject field and a Source / Preview tab. The Preview tab renders the raw Handlebars HTML in a sandboxed `<iframe>`. Save commits to DB via `PUT /api/admin/email-templates/:name`. |
| **Join analytics** | All-time click count, per-combo breakdown sorted by count, and a collapsible last-14-days list. Read-only; sourced from `GET /api/admin/analytics/join`. |
| **Feature flags** | Combobox (select) chooses the flag; checkbox for `enabled`; text input for `value` (e.g. Calendly event-type URI for `meetUs`). Save commits to DB via `PUT /api/admin/feature-flags/:name`. |

## Parliament Components

### `JoinSelector`

Frontend-only selector for the hitkpakdut flow. It asks for membership status and individual/couple mode, then opens one of the official effective-soft forms:

- `licudliberal` for new/renewal individual registration
- `licudliberal2` for new/renewal couple registration
- `licudliberal3` for existing Likud member individual group join
- `licudliberal4` for existing Likud member couple group join

It also shows direct fallback links and WhatsApp support. There is no backend route, no local storage, and no form-data proxy.

### `AddTrackingInput`

Accepts a URL or a raw numeric ID. Raw numeric IDs show an inline type selector for bill, committee, or MK.

Submits to `POST /api/tracking/add` through `api.tracking.add()`. On success, it clears the input and asks the parent to refresh parliament data.

Supported URL parsing is defined in `server/services/url-parser.ts`. Although the helper text mentions `gov.il`, the parser currently supports oknesset URLs, selected Knesset URLs, and raw IDs.

The wrapper uses `flex flex-col gap-2 sm:flex-row` so the input and button stack vertically on mobile and sit side-by-side on wider screens.

### `BillOverviewRow`

Collapsible row inside the bills tab. Shows the bill's title and status chip in collapsed state; expands to show committee, summary, position, notes, and links.

The title span uses `flex-1 min-w-0 truncate` — `min-w-0` is required for `truncate` to work in a flex container. The status chip has `shrink-0`. The committee paragraph uses `max-w-[10rem] truncate` to prevent very long committee names from overflowing on narrow screens.

### `MkCombobox` / `BillSearchCombobox` / `CommitteeCombobox`

Search comboboxes for adding tracked items. Each renders a trigger button and a floating dropdown list.

All three dropdown scroll containers use `max-h-[40vh] sm:max-h-60` (or `sm:max-h-64`) so the list adapts to the visible viewport when the software keyboard is open on mobile. On `sm+` screens the original fixed height is restored.

### `BillCard`

Displays a tracked bill's number, title, status, position, notes, source link, optional document link, and remove action. It uses status/position values from the `Bill` type.

### `CommitteeCard`

Displays committee name, chair, latest session date, optional summary/document link, source link, poll timestamp, and remove action.

### `MkCard`

Displays MK name, party, optional photo/email/roles, recent activity, source link, poll timestamp, and remove action. Activity currently comes from the Knesset OData scraper for Knesset-site MK URLs.

### `LetterPrivacyNotice`

Understated, i18n-driven privacy notice rendered on both Civic Letters pages (`LettersPage`, `LetterDetailPage`). Props: `className?: string` (merged onto the wrapping `<p>` for spacing/borders). Tells members that letter sends are tallied anonymously / in aggregate only and that their identity is never linked to a send — matching the `letter_analytics` table, which stores only `(letterId, action)` with no `user_id`. Copy lives under the `letters.privacy_title` / `letters.privacy_body` i18n keys (he + en).

## UI Primitives

`src/components/ui/` contains local shadcn-style primitives such as `button`, `card`, `input`, `sheet`, `tabs`, `badge`, `accordion`, and `separator`.

Some UI primitive files export both components and style helpers. ESLint reports `react-refresh/only-export-components` warnings for those files, but the current build and tests pass.

## Legacy Data Files

`representatives.json`, `updates.json`, `protocols.json`, and `primaries.json` still exist in `src/data/`, but their old sections are not mounted in the current app flow.
