# Component Reference

Current components live under `src/components/`. Styling is Tailwind-based, with shadcn-style primitives in `src/components/ui/`. There are no current `.module.css` component styles.

## App Composition

`src/App.tsx` mounts:

| Component | Purpose |
|-----------|---------|
| `layout/Header` | Sticky nav, logo, Knesset drawer trigger, new-data badge |
| `sections/HeroSection` | Main headline and CTAs |
| `sections/ParliamentStrip` | Horizontal preview of active bills and one committee |
| `sections/AboutSection` | About copy and values from `about.json` |
| `sections/GallerySection` | Gallery grid from `gallery.json` |
| `sections/FaqSection` | Accordion from `faq.json` |
| `sections/JoinSection` | Join selector and secure handoff to effective-soft |
| `sections/MeetUsSection` | Calendly booking for external visitors (anonymous only; hidden when `meetUs` flag off) |
| `layout/Footer` | Footer content |
| `layout/ParliamentDrawer` | Side drawer for tracked bills, committees, and MKs |

## Layout Components

### `Header`

Reads `site.json` for logo and party name. The nav links are currently `#about`, `#gallery`, `#faq`, and `#join`.

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

Reads headline, subtitle, and tagline from `site.json`. It exposes CTAs for joining and opening the Knesset tracking drawer.

### `ParliamentStrip`

Receives bills and committees from `App.tsx`. It shows up to three active bills, one committee, and a button that opens the full drawer.

Cards use `flex-wrap` so they wrap on narrow screens rather than causing horizontal scroll. Bill and committee cards have `min-w-[150px] sm:min-w-[180px]`. The "more" button is `w-full sm:w-auto` — full-width on mobile, auto on larger screens.

### `AboutSection`

Reads `about.json`. Renders paragraphs, values, and optional leadership items if present.

### `GallerySection`

Reads `gallery.json` and renders image cards with captions and dates.

### `FaqSection`

Reads `faq.json` and renders an accordion.

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

Loads all data in parallel on open (`listInvites`, `listUsers`, `emailTemplates.list`, `featureFlags.get`). Has four sections:

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

## UI Primitives

`src/components/ui/` contains local shadcn-style primitives such as `button`, `card`, `input`, `sheet`, `tabs`, `badge`, `accordion`, and `separator`.

Some UI primitive files export both components and style helpers. ESLint reports `react-refresh/only-export-components` warnings for those files, but the current build and tests pass.

## Legacy Data Files

`representatives.json`, `updates.json`, `protocols.json`, and `primaries.json` still exist in `src/data/`, but their old sections are not mounted in the current app flow.
