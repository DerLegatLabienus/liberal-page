# Meet Us — External Visitors Book a Meeting with the Cell

**Date:** 2026-06-12
**Status:** Approved design
**Backlog:** #15 ("Meet Us" — Scheduled Meetings with Cell Members)
**Depends on:** Google verification infrastructure from #3 (shipped: `verifyGoogleIdToken`, `@react-oauth/google`, `VITE_GOOGLE_CLIENT_ID`). **Not** gated on membership/login.

## Goal

A homepage **"Meet Us"** section for **external visitors** — in the happy flow, politicians who want to set up a meeting with the cell. A visitor proves their identity with a **valid Google account** (Google sign-in → ID token verified server-side) but does **not** need to be an invited member or logged into the site. Booking happens via **Calendly** (Zoom link auto-generated, or in person per the event type); the app never hosts meetings and **stores no data** about visitors or meetings. One **active booking per verified Google email** at a time.

## Decisions (locked)

- **Audience: external visitors.** The section renders **only for anonymous visitors**; signed-in members (the cell side — they're the hosts) do not see it.
- **Auth tier: "Google-verified visitor", not "member".** The booking endpoint verifies a Google **ID token** per request (existing `verifyGoogleIdToken`, same client ID) and extracts the verified email + name. **No allowlist check, no user row, no session, no refresh token** — the identity is used once and discarded.
- **Architecture: stateless pull.** No lock table, no webhooks, no DB rows of any kind. The one-active-booking rule is enforced by querying the Calendly API live at booking time, keyed to the **verified Google email**. Calendly is the single source of truth. (The backlog's lock-table + webhook sketch is rejected: it duplicates Calendly's state and pays — Standard plan webhooks, a public signed endpoint, drift handling — to keep the duplicate fresh. Same pull-over-webhooks lesson as the Resend delivery-status change of 2026-06-11.)
- **One endpoint; the 409 is the status.** There is no separate "status" endpoint: a booking request when a meeting already exists returns `409` **carrying the existing meeting's details**, which the UI renders.
- **Booking UI: embedded Calendly popup** (official embed script) over our page, prefilled with the **Google-verified** name/email. No redirect.
- **Cancel/reschedule: on Calendly's own pages** via the `cancel_url`/`reschedule_url` we surface transiently in the 409 response. Cancelling self-heals the gate (next live query sees no active event).
- **Host selection / meeting type (backlog tension #4): config, not code.** The Calendly **event-type URI** lives in admin-editable DB config. 1-on-1 fixed host (Free plan), round-robin rotation (Teams plan), or a fixed panel are just different event types — switching is a live config edit, no deploy/restart.
- **Data residency (backlog tension #2):** "no data stored" means **our backend** — we hold nothing, not even a lock. Calendly stores the booking (name, email, time) on its side — accepted.

## Configuration

| Setting | Where | Meaning |
|---|---|---|
| `CALENDLY_API_TOKEN` | Render env var (secret) | Personal access token. Unset ⇒ feature unconfigured, section hides. Same no-op philosophy as `RESEND_API_KEY`. |
| `meetUs` feature flag | `feature_flags` table (existing) | `enabled` gates the section; `value` holds the **Calendly event-type URI**. Admin-editable; effective immediately. |

The frontend learns `enabled` from the existing public `GET /api/feature-flags`. **Accepted exposure:** that endpoint returns flag values, so the event-type URI is visible — a Calendly event type maps to an inherently public booking page, so nothing sensitive leaks.

### Admin flag editing (small enabler)

The admin panel can read flags but not write them. Add:
- `PUT /api/admin/feature-flags/:name` (`requireAdmin`), body `{ enabled: boolean; value: string | null }` → `FeatureFlagsRepository.setFlag` (exists). `400` on invalid body.
- AdminPanel: a "Feature flags" section — enabled checkbox + value input + Save per flag (same pattern as the email-templates editor).

## Backend

### `server/services/calendly.ts` (new)

Lazy client over the Calendly v2 REST API (`https://api.calendly.com`), bearer `CALENDLY_API_TOKEN`. Mirrors `getResend()`: token unset ⇒ unconfigured; `_resetCalendly()` for tests.

- `isConfigured(): Promise<boolean>` — token present AND `meetUs` flag enabled with a non-empty event-type URI.
- `findActiveMeeting(email: string): Promise<ActiveMeeting | null>` where `ActiveMeeting = { startTime: string; cancelUrl: string; rescheduleUrl: string }`:
  1. `GET /scheduled_events?invitee_email=<email>&status=active&min_start_time=<now>&organization=<org-uri>` (org URI resolved once from `GET /users/me`, cached in-memory).
  2. If an event exists, `GET /scheduled_events/{uuid}/invitees` → take that invitee's `cancel_url`/`reschedule_url`.
  3. Result returned transiently; never persisted. Gate calls always run **fresh** (no cache) — there is no UI polling to amortize, so no result cache is needed.
- `createSingleUseLink(): Promise<string>` — `POST /scheduling_links` `{ max_event_count: 1, owner: <event-type URI>, owner_type: 'EventType' }` → `booking_url`.
- Calendly HTTP errors: logged with `[meetus]` prefix, thrown as a typed error → route translates to `502`. Failure of the gate check **refuses** booking (closed on failure, never open).

### `server/routes/meetings.ts` (new, mounted at `/api/meetings` — public, no auth middleware)

`POST /api/meetings/booking-link`, body `{ idToken: string }`:
1. **Rate limit** (in-memory, no deps): max **10 requests/min per IP** and **5/min per verified email**; exceeded → `429`. Map-based sliding window, pruned opportunistically.
2. `idToken` missing → `400`.
3. `verifyGoogleIdToken(idToken)` → invalid/expired → `401`. Yields verified `email`, `name`. (No allowlist lookup — deliberately.)
4. Not configured (token/flag/URI) → `409 { error: 'not_configured' }` (UI hides the section anyway via the flag; this is a backstop).
5. `findActiveMeeting(email)` → exists → **`409 { error: 'active_meeting', meeting: { startTime, cancelUrl, rescheduleUrl } }`**.
6. Else → `200 { bookingUrl, name, email }` (name/email echoed for the embed prefill).
7. Calendly failure → `502`.

The verified email is the gate key; nothing from the request body besides `idToken` is trusted.

## Frontend

### `src/components/sections/MeetUsSection.tsx` (new)

Rendered on the homepage alongside other sections **only when**: `meetUs` flag enabled **and** `useAuthOptional()?.user == null` (anonymous visitors only — signed-in members never see it). Hebrew-first; i18n keys in `he.json` + `en.json`.

States:
1. **Initial** — outreach blurb ("רוצים לפגוש אותנו?") + a `GoogleLogin` button (`@react-oauth/google`, already wired with `VITE_GOOGLE_CLIENT_ID`) as the CTA.
2. **On Google success** → `api.meetings.bookingLink(credential)`:
   - `200` → load Calendly embed script lazily (`https://assets.calendly.com/assets/external/widget.js`), `Calendly.initPopupWidget({ url })` with `?name=&email=` prefill from the response.
   - `409 active_meeting` → render "כבר קבועה לך פגישה ב־<date>" + cancel/reschedule links (`target="_blank"`), note that cancelling frees the slot.
   - `429` → toast "יותר מדי ניסיונות, נסו שוב מאוחר יותר"; `401`/`502` → generic failure toast (`useToastOptional`).
3. **Booked** — on the embed's `calendly.event_scheduled` window message → swap to a confirmation state ("הפגישה נקבעה! פרטים נשלחו למייל"). No refetch needed — Calendly emailed them everything; our UI state is cosmetic.

### `src/lib/api-client.ts`

- `api.meetings.bookingLink(idToken)` → `POST /meetings/booking-link` (no bearer header needed; endpoint is public).
- `api.admin.featureFlags.update(name, { enabled, value })` → `PUT /admin/feature-flags/:name`.

## Booking flow (end to end)

1. Anonymous visitor (e.g. a politician) sees Meet Us → clicks the Google button → Google popup → ID token.
2. `POST /api/meetings/booking-link` → rate limit → verify token → live Calendly gate on the verified email.
3. No active meeting → single-use link issued → Calendly popup opens prefilled → visitor picks a slot → Calendly creates the meeting + Zoom link and emails both sides. **Nothing written to our DB.**
4. The single-use link is consumed (`max_event_count: 1`); leaking it is harmless.
5. Re-attempt while a meeting is pending → `409` + meeting details rendered with cancel/reschedule links. After cancellation or after the meeting's start time passes, the live query stops matching → booking re-enabled. No expiry logic needed.

## Known accepted limitations

- **Prefill is editable** in the Calendly form: a visitor could book under a different email and evade the one-active-booking gate. Low stakes (worst case: extra bookings, visible in the Calendly dashboard); revisit only if abused.
- **Public event-type URL:** anyone holding the Calendly event's public URL can book directly on Calendly, bypassing our gate entirely. Inherent to Calendly — the broker adds verification + gating + prefill, not secrecy.
- **In-memory rate limit** resets on server restart and is per-instance — adequate for a single Render instance.
- **Calendly outage** ⇒ gate can't be checked ⇒ booking refused (`502`), never an open gate.

## Error handling

Summarized in the route steps above: `400` no token, `401` bad token, `409` not-configured / active meeting (with details), `429` rate-limited, `502` Calendly failure. Flag disabled or token unset ⇒ section hidden client-side, `409 not_configured` server-side.

## Testing

- **`calendly.ts`** (mock `fetch`): unconfigured ⇒ no HTTP; `findActiveMeeting` maps event + invitee URLs / returns null; `createSingleUseLink` posts the correct body and returns `booking_url`; HTTP error ⇒ typed throw.
- **`meetings` route** (supertest, mocked `verifyGoogleIdToken` + calendly service): missing token `400`; invalid token `401`; unconfigured `409 not_configured`; active meeting `409` with meeting payload; happy path `200 { bookingUrl, name, email }`; Calendly throw `502`; rate limit `429` after burst (fake timers).
- **Admin flags route:** `PUT` updates via `setFlag`; `400` invalid body; admin-gated.
- **`MeetUsSection`** (happy-dom, mocked `GoogleLogin` like `AuthControl.test.tsx`): hidden when flag off or user signed in; Google success → `bookingLink` called with credential; `409` renders meeting + links; booked state on `event_scheduled` message; error toasts.

## Operator prerequisites (manual, one-time)

1. Calendly account (Free works) + one event type (location = Zoom or in person; the event type also decides 1-on-1 vs round-robin (Teams plan) vs panel).
2. Personal access token → `CALENDLY_API_TOKEN` on Render.
3. Event-type URI (`GET /event_types?user=<me>`) → set as the `meetUs` flag value + enable, via the admin panel.

## Out of scope (YAGNI)

- Webhooks / lock table / any persistence (see Decisions).
- In-app cancel/reschedule (Calendly's pages handle it).
- Member-facing booking (members are the hosts; they don't see the section).
- Enforcement against prefill-email evasion; CAPTCHA (Google verification + rate limit suffice for now).
