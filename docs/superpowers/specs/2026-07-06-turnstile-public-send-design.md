# Turnstile-Gated Public Letter Pages — Design

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan
**Feature flag:** `publicSendTurnstile`

## Goal

Protect the integrity of the public letter **send count** (and the letter
ranking it feeds) against scripted inflation, by gating the public share pages
behind a Cloudflare Turnstile check — presented as an **interstitial wall**:
the letter is hidden until a Turnstile challenge is passed.

The primary product objective remains "increase the number of sent letters."
The interstitial is a deliberate, owner-chosen tradeoff: it adds friction (and
will block the small share of visitors who cannot reach Cloudflare) in exchange
for a send count that reflects real humans and a ranking that cannot be gamed.

## Background & threat model

- Public share pages (`letter/{id}.html`) are **static HTML served from R2/CDN**.
  There is no per-request server rendering.
- Each page fires `navigator.sendBeacon()` to the no-auth endpoint
  `POST /api/public/letters/:id/send` on each send action (mailto / Gmail /
  copy). The endpoint records into `public_*` analytics buckets and bumps the
  letter's activity score.
- **What we protect:** the *count* and the *ranking*. The letter content is
  public advocacy material we *want* spread — it has no protection value.
- **The only realistic attack:** a script POSTing directly to the endpoint to
  inflate the counter. Such a bot never loads the page, so a page-level wall
  alone does nothing to it. **The real integrity gate is therefore server-side:
  the endpoint verifies a Turnstile token before recording.** The interstitial
  is the UX layer the owner has chosen on top of that server gate.

## Architecture

Client-side interstitial + server-side verification.

```
Visitor opens letter/{id}.html
  → letter content is present but HIDDEN
  → Turnstile Managed widget renders on page load
  → challenge passes (invisible ~1s for most; one checkbox for suspicious traffic)
      → letter content revealed; token held in the page
  → visitor clicks Send (mailto / Gmail / copy)
      → beacon POSTs to /api/public/letters/:id/send with the live token
         (text/plain body → "simple" request → no CORS preflight)
  → SERVER: throttle → verifyTurnstile(secret, token) → record ONLY on success
Bot POSTing directly with no/forged token → siteverify fails → not counted.
Turnstile fails to load (adblock / CF outage) → content stays walled →
      fallback link to the main-site letter page is shown (visitor not stranded).
```

Crawler previews (WhatsApp/Facebook/Twitter) are unaffected: OG/Twitter meta
live in `<head>` and never execute the Turnstile JS.

## Components

### 1. `server/services/turnstile.ts` (new)

```
verifyTurnstile(token: string, remoteip?: string): Promise<TurnstileResult>
```

- POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with
  `secret=TURNSTILE_SECRET_KEY`, `response=token`, and optional `remoteip`.
- Returns a small tri-state so the caller can distinguish:
  - `verified` — siteverify returned `success: true`
  - `rejected` — siteverify returned `success: false` (missing/forged/expired/reused)
  - `skip` — `TURNSTILE_SECRET_KEY` is unset (misconfiguration → fail-open at the
    call site so a bad deploy does not silently zero the metric; log a warning)
- Network error / non-200 → `rejected` (fail-closed on transient CF errors is
  acceptable; those sends simply are not counted).

### 2. `server/services/share-config.ts`

- Add `turnstileSiteKey: string` to `ShareConfig`, read from `TURNSTILE_SITE_KEY`
  (`''` when unset).
- The **wall is baked only when `turnstileSiteKey !== ''`.** When empty, pages
  render exactly as today (content visible, no widget).

### 3. `server/services/share-renderer.ts` — `renderShareHtml`

When `turnstileSiteKey` is present, the rendered page:
- Loads the Turnstile script:
  `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
- Renders a Managed widget bound to the sitekey with an explicit success
  callback and error/timeout callbacks.
- Wraps the letter card (tags, title, recipients, body, action buttons) in a
  **hidden** container (`hidden` attribute / `display:none`).
- Inline JS:
  - **success callback** → reveals the content container; stores nothing (token
    is read live at send time via `turnstile.getResponse()`).
  - **send handlers** (existing mailto/Gmail/copy listeners) → read the live
    token and include it in the beacon body:
    `navigator.sendBeacon(track + '?action=' + action, token)`.
  - **error / timeout callback** → keep content walled, reveal a fallback link
    to `${appBaseUrl}/letters/{id}?src=share-fallback` so the visitor can still
    reach the letter on the main site.
- `refresh-expired: 'auto'` (Turnstile default) handles the idle-token case; the
  send reads the current token, not a cached one.

When `turnstileSiteKey` is empty: no script, no widget, content visible — the
current behavior, unchanged.

**Note:** the R2 objects carry no CSP, so the Turnstile script loads normally
(this is not an Artifact-CSP context).

### 4. `server/routes/public-letters.ts`

- Add body parsing for the send route: `express.text({ type: '*/*', limit: '4kb' })`
  (Turnstile tokens are up to ~2 KB; the beacon body is the raw token string).
- Order of checks (unchanged early exits kept): valid id + action → `lettersEnabled`
  → letter published → **IP throttle** (cheap pre-verify backstop; also bounds
  siteverify calls under a naive flood) → then inside `setImmediate`:
  - `result = verifyTurnstile(token, ip)`
  - record + `incrementActivityScore` **only** when `result === 'verified'`
    OR `result === 'skip'` (fail-open on misconfig).
  - `result === 'rejected'` → do nothing (not counted).
- Always returns `204` (uniform, no information leak), as today.
- Gated additionally by the `publicSendTurnstile` flag: when the flag is **off**,
  skip verification entirely and record as today (current behavior).

### 5. Feature flag `publicSendTurnstile`

- Seeded in `feature_flags` (default **off**).
- Controls **server-side enforcement** only.
- **Operational note:** the interstitial wall is baked into the page HTML, so
  enabling/disabling the *wall itself* requires regenerating pages
  (`npm run letters:regen`) in addition to flipping the flag. Recommended
  sequence to enable: set env keys → turn flag on → regenerate pages. To
  disable: turn flag off → regenerate pages (so visitors are not walled while
  the server no longer enforces).

### 6. `.env.example`

```
# Cloudflare Turnstile — public letter send-page bot gate (publicSendTurnstile flag).
# Create a Managed widget in the Cloudflare dashboard (same account as R2).
# TURNSTILE_SITE_KEY is public (baked into the static share page HTML).
# TURNSTILE_SECRET_KEY is server-side only (used for siteverify).
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

## Failure handling / graceful degradation

| Condition | Behavior |
|---|---|
| Turnstile can't load (adblock, CF outage) | Content stays walled; fallback link to main-site letter page shown. Accepted volume cost. |
| `TURNSTILE_SECRET_KEY` unset (misconfig) | `verifyTurnstile` → `skip` → server counts anyway (fail-open) + logs a warning. Metric never silently zeroes. |
| `publicSendTurnstile` flag off | Server records without verifying (current behavior). |
| Token expired while visitor idle | Turnstile auto-refreshes; send reads the live token. |
| Bot POSTs directly, no/forged/reused token | siteverify `rejected` → not counted. |

## Ranking

Because only *verified* sends are recorded, only verified sends bump the
activity score — so anonymous fake sends can no longer influence letter
ranking. This closes the previously-noted ranking-manipulation concern without a
separate change.

## Testing

- **`tests/server/turnstile.test.ts`** — `verifyTurnstile`: mocked siteverify
  `success:true` → `verified`; `success:false` → `rejected`; secret unset →
  `skip` (no network call); network error / non-200 → `rejected`.
- **`tests/server/public-letters-route.test.ts`** (extend) — flag on + valid
  token (verify mocked `verified`) → records into `public_*`; invalid/absent
  token (`rejected`) → `204`, no record; secret unset (`skip`) → records
  (fail-open); flag off → records without verifying (regression); foreign-Origin
  CORS still works (existing regression test preserved).
- **`tests/server/share-renderer.test.ts`** (extend) — sitekey present →
  HTML contains the Turnstile script, a widget bound to the sitekey, a hidden
  content container, the reveal script, and the fallback link; sitekey absent →
  no widget, content visible (current behavior preserved).

## Out of scope

- The optional Google-signed "count me" / verified-signatory feature (a separate
  future spec).
- Replacing the IP throttle with a shared-store rate limiter (only if real abuse
  appears after Turnstile ships).
- Any change to the member (logged-in) send path.

## Setup dependency (owner)

Create a Cloudflare Turnstile **Managed** widget (same Cloudflare account as R2)
to obtain the sitekey + secret; set `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`
on Render and locally.
