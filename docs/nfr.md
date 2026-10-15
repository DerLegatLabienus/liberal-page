# Non-functional requirements

One page for the requirements that every change has to keep, whatever its feature. Each one
cites where it was decided. A plan or a review that says a change "fits the non-functional
requirements" points at the numbered items here (for example `SEC-3`, `PRIV-1`).

This page collects decisions already made; it does not add new ones. A requirement that is not
written in a source below is not a requirement yet. **Known gaps** at the end of each section
are things the sources admit are missing, listed so a plan does not assume they exist.

Sources are paths from the repository root. `CLAUDE.md` means the project `CLAUDE.md`.

---

## 1. Security

**Access control**

- **SEC-1. Every route has a stated audience.** Routes are public, `requireAuth`, `requireAdmin`
  or `optionalAuth`; the API table records which.
  *Source:* `docs/architecture.md` (Auth & multi-user), `CLAUDE.md` (Backend API).
- **SEC-2. Accounts are invite-only, behind one gate.** Every sign-in method ends in
  `loginWithIdentity`, which checks the `allowed_emails` allowlist. No front door skips it.
  *Source:* `docs/architecture.md` (Auth & multi-user),
  `docs/superpowers/specs/2026-06-03-multi-user-accounts-design.md`.
- **SEC-3. An email is trusted only when the provider has verified it** (nOAuth mitigation):
  Google's `email_verified === true`, or delivery for the magic link. Unverified gets `403`.
  Microsoft stays off until the `xms_edov` claim can be relied on.
  *Source:* `docs/superpowers/specs/2026-07-07-multi-provider-login-design.md` (Security
  considerations), `CLAUDE.md` (`POST /api/auth/:provider`).
- **SEC-4. Tokens are short-lived or hashed.** Access JWTs last 15 minutes; refresh tokens rotate
  and only their sha256 hash is stored; reuse of a rotated token revokes all of that user's
  sessions. Magic-link tokens are 32 random bytes, stored hashed, single-use, 15-minute expiry.
  *Source:* `docs/architecture.md` (Auth & multi-user),
  `docs/superpowers/specs/2026-07-07-multi-provider-login-design.md`.
- **SEC-5. Public endpoints do not reveal who is a member.** The magic-link request always
  answers `200`, whether or not the email is known.
  *Source:* `docs/superpowers/specs/2026-07-07-multi-provider-login-design.md`, `CLAUDE.md`.
- **SEC-6. Dev sign-in never reaches production.** `ALLOW_DEV_LOGIN` is guarded by three
  conditions in code, not by convention.
  *Source:* `CLAUDE.md` (Local full-stack dev), `server/services/auth-providers/dev.ts`.

**Input, output and outbound requests**

- **SEC-7. Server-side document fetches go through the URL guard.** Host allowlist
  (`*.knesset.gov.il`), a check that every resolved address is public, redirects re-checked (at
  most 3), a 15 s timeout and a 15 MB cap. A new outbound fetch of a user-supplied URL uses it.
  *Source:* `CLAUDE.md` (SSRF guard), `server/services/url-guard.ts`.
- **SEC-8. Letter and template HTML is sanitised on the server before it is stored**, with a
  strict allowlist, because it is later opened in a scriptable context. Public share pages reuse
  that stored HTML and add no second path. `src/` has no `dangerouslySetInnerHTML` (checked
  2026-10-15).
  *Source:* `CLAUDE.md` (Letter & template HTML), `server/services/html-sanitizer.ts`,
  `docs/superpowers/specs/2026-06-20-public-share-pages-design.md` (Privacy & security),
  `docs/superpowers/specs/2026-09-06-llm-call-security-design.md` (What already works).
- **SEC-9. Uploads are checked by their bytes, not their declared type.** Letter images: raster
  only (PNG, JPEG, GIF, WebP), at most 5 MB, checked by magic bytes before they reach R2.
  *Source:* `docs/architecture.md` (R2 Media), `docs/superpowers/specs/2026-07-01-letter-media-library-design.md`.
- **SEC-10. Email template values are HTML-escaped** unless a value is explicitly marked `raw`.
  *Source:* `docs/architecture.md` (Email).
- **SEC-11. Clients never see a stack trace.** The final error handler logs the error and answers
  `500 {"error":"Server error"}`.
  *Source:* `server/index.ts` (final error handler).
- **SEC-12. CORS is an allowlist** (`CORS_ORIGIN`). The one exception is the public send beacon
  (`/api/public/letters`), mounted with open CORS before the allowlist, because R2-hosted pages
  call it from another origin.
  *Source:* `docs/architecture.md` (Public Share Pages), `server/index.ts`.

**Abuse and rate limits**

- **SEC-13. Rate limits.** The endpoints that have one today:

  | Endpoint | Limit |
  |---|---|
  | `POST /api/meetings/booking-link` | 10/min per IP and 5/min per verified email |
  | `POST /api/summarize` | 10/min per IP (and `requireAuth`) |
  | `POST /api/auth/magic-link/request` | 5 per 15 min per (IP, email) |
  | `POST /api/admin/letters/beautify` | 1 per 2 min per caller; an empty body or an unconfigured AI service does not use the slot |
  | `POST /api/public/letters/:id/send` | 10 s throttle per (IP, letter, action) |

  The limiter is the in-memory `SlidingWindowLimiter`: it resets on restart and is per instance,
  which is accepted for a single Render instance. Other public endpoints (for example
  `POST /api/analytics/join`, `GET /api/feature-flags`, `GET /api/parliament/:type`) have none.
  *Source:* `docs/superpowers/specs/2026-06-12-meet-us-design.md`, `CLAUDE.md` (Backend API),
  `docs/architecture.md` (Public Share Pages), `server/services/rate-limit.ts`.
- **SEC-14. Public send counts can be bot-checked** with Cloudflare Turnstile behind the
  `publicSendTurnstile` flag. A missing secret fails *open* (the send is still counted), so a
  misconfiguration cannot silently zero the metric.
  *Source:* `docs/superpowers/specs/2026-07-06-turnstile-public-send-design.md`,
  `docs/architecture.md` (Public Share Pages).
- **SEC-15. LLM output is relevance-gated.** The summariser asks the model whether a document is
  relevant and stores nothing when it is not.
  *Source:* `CLAUDE.md` (`POST /api/summarize`), `server/services/summarizer.ts`.

**Secrets and data access**

- **SEC-16. Secrets live in environment variables only**, never in the repo or in client code.
  R2 write credentials stay on the server; the bucket is public-read, private-write.
  *Source:* `docs/superpowers/specs/2026-06-20-public-share-pages-design.md` (Privacy &
  security), `CLAUDE.md` (`loop_read`: the connection string lives only in the routine's
  environment).
- **SEC-17. Local development never points at the production database.** Use the Neon `dev`
  branch or local Docker Postgres. No code enforces this.
  *Source:* `CLAUDE.md` (Local database),
  `docs/superpowers/specs/2026-07-24-local-database-environment-design.md`.
- **SEC-18. Render PR previews stay off**: a preview copies every production secret and the
  production database connection.
  *Source:* `CLAUDE.md` (Git & Deploy Workflow).
- **SEC-19. Destructive SQL against production needs the developer's say-so** (`DROP`, `DELETE`,
  `TRUNCATE`, `UPDATE` without `WHERE`). Production data scripts are the risky tier.
  *Source:* `CLAUDE.md` (Infrastructure & Tooling Map, Git & Deploy Workflow).

**Known gaps**

- The LLM call surface has an approved design that is not built yet: one chokepoint for
  `@anthropic-ai/sdk`, injection defence on the poller's unattended path, an audit log and
  per-policy daily ceilings. Today the poller's summarise calls skip the route's auth and rate
  limit, and nothing caps total volume.
  *Source:* `docs/superpowers/specs/2026-09-06-llm-call-security-design.md` (The actual gaps).

---

## 2. Privacy

- **PRIV-1. Logs carry no personal data.** No email addresses, phone numbers, names of private
  people, tokens, letter or draft bodies, or request bodies. Where an identifier is needed, use an
  internal ID. Email log lines redact the address to its local part with `redactEmail` and carry
  the Resend message ID.
  *Source:* `docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md` (Privacy of logged
  data), `docs/architecture.md` (Email), `server/services/email-redaction.ts`.
- **PRIV-2. Public pages carry no member data.** A public share page holds only the
  admin-written letter and the recipients' display names (public officials). Only published
  letters get a page; unpublishing or deleting a letter removes it.
  *Source:* `docs/superpowers/specs/2026-06-20-public-share-pages-design.md` (Privacy &
  security).
- **PRIV-3. Public analytics are anonymous counters.** Public send events go to their own
  `public_*` buckets, apart from member engagement. A per-recipient count records the contact
  ID, not who sent it.
  *Source:* `docs/architecture.md` (Public Share Pages), `CLAUDE.md` (`POST /api/public/letters/:id/send`).
- **PRIV-4. Identity used once is discarded.** Meet Us verifies an outside visitor's Google
  identity for one booking and stores nothing; Calendly is the record.
  *Source:* `docs/architecture.md` (Meet Us),
  `docs/superpowers/specs/2026-06-12-meet-us-design.md`.
- **PRIV-5. The email ledger is minimal and bounded.** `sent_emails` keeps the fields needed for
  delivery status, and the storage reclaimer trims its oldest rows first.
  *Source:* `docs/architecture.md` (Email, Poller).
- **PRIV-6. The unattended loop sees no personal data.** It reads production only through the
  `loop_read` views, which name each column and leave out emails, phones, user records, tokens,
  draft letters and free-text bodies. New tables and columns stay invisible to it until the
  developer adds them to a view.
  *Source:* `CLAUDE.md` (`loop_read`), `scripts/loop-read-views.sql`.

---

## 3. Logging and monitoring

- **LOG-1. Logs go to the console** — the server's stdout as read on Render, or the browser
  console. Log lines name events and identifiers, not content (see PRIV-1).
  *Source:* `docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md` (Logging).
- **LOG-2. Best-effort side work logs and carries on.** Share-page publishing, bill alert
  digests and email delivery polling are isolated: a failure is logged and never blocks the
  admin save or fails the poll cycle. `sendEmail` never throws.
  *Source:* `docs/architecture.md` (Poller, Email, Public Share Pages).
- **MON-1. `/api/health` is the liveness signal.** Render's health check uses it, so a build that
  does not answer never replaces the running one.
  *Source:* `CLAUDE.md` (Git & Deploy Workflow).
- **MON-2. CI gates the deploy.** Render deploys only after the commit's CI checks pass, so a
  failing commit never runs its migrations. GitHub Pages deploys through the CI-gated
  `deploy.yml`.
  *Source:* `CLAUDE.md` (Git & Deploy Workflow).
- **MON-3. Product metrics already recorded:** join click-throughs
  (`/api/admin/analytics/join`), letter sends per channel and source (admin letters dashboard),
  email delivery status (`sent_emails.status`). A plan names one of these before it proposes a
  new metric.
  *Source:* `docs/superpowers/specs/2026-06-02-join-analytics-design.md`, `docs/architecture.md`
  (Public Share Pages, Email), `docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md`
  (Metrics).

**Known gaps**

- Nothing alerts anyone. Failures are noticed by reading Render logs, by the health check
  stopping a deploy, or by a user. A plan where nothing would notice a failure says so.
  *Source:* `docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md` (Monitoring).

---

## 4. Performance

- **PERF-1. Slow external data is cached in Postgres.** The MK list is cached for 6 hours
  (`knesset_members_cache`); committee lists in `knesset_committees_cache`; document summaries in
  `summaries_cache`, keyed by the MD5 of the document's bytes, so a document is summarised once.
  *Source:* `CLAUDE.md` (Backend API, Repositories and caches).
- **PERF-2. The poller runs in the background, not in a request.** Every 6 hours by default
  (`POLL_INTERVAL_MS`); on total failure it backs off from 1 minute up to 10 minutes.
  *Source:* `CLAUDE.md` (Poller), `docs/superpowers/specs/2026-05-19-poller-backoff-design.md`.
- **PERF-3. Bulk email is throttled** (about 2 per second via `sendEmailsThrottled`), and
  delivery polling is capped at 100 rows per cycle, oldest first.
  *Source:* `docs/architecture.md` (Email).
- **PERF-4. Pages that strangers open do not wait on the backend.** Public share pages are
  rendered once at publish time and served from R2, because a Render cold start (30–60 s) would
  break link previews and first opens.
  *Source:* `docs/superpowers/specs/2026-06-20-public-share-pages-design.md`,
  `docs/superpowers/specs/2026-07-04-public-letter-send-pages-design.md`.
- **PERF-5. Heavy or native modules load lazily** so they cannot slow or break server boot
  (`satori`, `@resvg/resvg-js`; pglite only under test).
  *Source:* `docs/architecture.md` (Public Share Pages, DB Module).
- **PERF-6. Loading states do not shift the layout.** A list that loads uses a structural
  skeleton that mirrors the real DOM.
  *Source:* `docs/design-system.md` §7.

---

## 5. Accessibility

- **A11Y-1. Keyboard first.** Visible focus (the `ring` token); every interactive element
  reachable and usable by keyboard; menus close on `Escape` and give focus back.
  *Source:* `docs/design-system.md` §9.
- **A11Y-2. Real semantics.** `role` and `aria-*` on custom widgets, `aria-label` on icon-only
  controls, a label on every input.
  *Source:* `docs/design-system.md` §9.
- **A11Y-3. Contrast and motion.** Colours come from tokens only (they are tuned for contrast);
  `prefers-reduced-motion` is respected.
  *Source:* `docs/design-system.md` §2, §7, §9.
- **A11Y-4. No dead ends or blank areas.** A page the user cannot see offers `BackToHome`; every
  list has an empty state; results go through toasts.
  *Source:* `docs/design-system.md` §7.
- **A11Y-5. Works down to phone width** (checked at 375 px): no page-level horizontal scroll;
  wide content scrolls in its own container.
  *Source:* `docs/design-system.md` §8,
  `docs/superpowers/specs/2026-05-28-mobile-responsiveness-design.md`.

---

## 6. RTL and language

- **RTL-1. Public surfaces are Hebrew-first and right-to-left.** Direction comes from
  `document.documentElement.dir` through `useDirection()`; language from `?lang=` or
  `localStorage`.
  *Source:* `docs/design-system.md` §5, `docs/architecture.md` (Directionality).
- **RTL-2. Public copy goes through i18n keys** (`src/locales/{he,en}.json`), never hardcoded.
  Some sections render only in Hebrew.
  *Source:* `docs/design-system.md` §5, `CLAUDE.md` (Frontend flow),
  `docs/superpowers/specs/2026-05-17-i18n-design.md`.
- **RTL-3. Logical properties only** (`start`/`end`, `ms-*`/`me-*`, `ps-*`/`pe-*`,
  `text-start`, `border-s`), and direction-sensitive glyphs mirrored with `useDirection()`.
  *Source:* `docs/design-system.md` §5.
- **RTL-4. No bare "Loading…" text on an RTL page** (the bidi ellipsis bug); use a skeleton.
  *Source:* `docs/design-system.md` §7.
- **RTL-5. Admin tools are `dir="ltr"` with no i18n keys**, a deliberate exception.
  *Source:* `docs/design-system.md` §5, `CLAUDE.md` (Multi-channel letters).
  **The sources disagree on the language — for the developer to settle:** `docs/design-system.md`
  §5 says the admin surfaces, `AdminLettersPage` included, are English; `CLAUDE.md` says the
  letters admin UI is Hebrew-only.
- **RTL-6. Hebrew in generated images is reordered to visual order** (`server/services/bidi.ts`)
  because `satori` has no bidi support.
  *Source:* `docs/architecture.md` (Public Share Pages).

---

## 7. Cost

- **COST-1. Free tiers.** Neon was chosen for its free tier; the database runs on a small Neon
  tier with a size budget.
  *Source:* `docs/superpowers/specs/2026-05-30-database-migration-design.md` (Why Drizzle + Neon),
  `docs/portfolio-review.md` (Infrastructure and cost constraints).
- **COST-2. The database stays inside its size budget on its own.** The storage reclaimer runs
  each poll cycle when size passes `limit − slack` (flag `storagePressure`, default `"450:2"`
  MB): oldest email ledger rows first, then the stalest entities nobody tracks. Tracked items are
  never deleted.
  *Source:* `docs/superpowers/specs/2026-06-02-storage-pressure-design.md`,
  `docs/architecture.md` (Poller).
- **COST-3. Paid-plan features are avoided, not assumed.** Resend webhooks need a paid plan, so
  delivery status is pulled instead.
  *Source:* `docs/architecture.md` (Email), `docs/portfolio-review.md`.
- **COST-4. Each LLM call is paid for**, so calls are cached (PERF-1), rate-limited (SEC-13) and
  gated by flags where an admin triggers them (`lettersBeautifyEnabled`).
  *Source:* `CLAUDE.md` (Backend API),
  `docs/superpowers/specs/2026-09-06-llm-call-security-design.md`.
- **COST-5. Email, SMS and WhatsApp go out from the sender's own app** (compose links), so
  there is no backend sender to pay for.
  *Source:* `CLAUDE.md` (Multi-channel letters),
  `docs/superpowers/specs/2026-07-15-communications-channels-design.md`.

**Known gaps**

- The LLM daily ceilings in the approved design are not built (see Security, Known gaps).

---

## 8. Availability

- **AVAIL-1. A missing integration degrades; it does not crash.** Without its env vars, each
  integration fails closed or does nothing: Resend skips the send, R2 routes answer `503`,
  Calendly answers `409 not_configured`, Anthropic answers `503`, Turnstile fails open. The
  server still boots.
  *Source:* `CLAUDE.md` (Local full-stack dev — what's real vs. faked).
- **AVAIL-2. When a check cannot be made, the safe answer wins.** Calendly errors fail closed (no
  booking link); the public send counter fails open (SEC-14).
  *Source:* `docs/architecture.md` (Meet Us, Public Share Pages).
- **AVAIL-3. A bad deploy keeps the old one serving.** Migrations apply on boot; if the new build
  fails its health check, the previous version keeps serving (MON-1, MON-2).
  *Source:* `CLAUDE.md` (Git & Deploy Workflow, `loop_read` migration hazard).
- **AVAIL-4. Migrations must not break the `loop_read` views.** A migration that drops or
  retypes a column, or drops a table, that a view uses starts with
  `DROP SCHEMA loop_read CASCADE;`, and the views are re-created afterwards. Otherwise the
  deploy fails.
  *Source:* `CLAUDE.md` (`loop_read`).
- **AVAIL-5. Shared links stay up when the backend sleeps.** Public share pages are served from
  R2 (PERF-4); the frontend is static on GitHub Pages.
  *Source:* `docs/superpowers/specs/2026-06-20-public-share-pages-design.md`, `CLAUDE.md`
  (Infrastructure & Tooling Map).
- **AVAIL-6. One backend instance.** In-memory state (rate limits) is per instance and lost on
  restart; that is accepted while there is one instance.
  *Source:* `docs/superpowers/specs/2026-06-12-meet-us-design.md`.

**Known gaps**

- The backend is on Render's free tier and sleeps when idle: the first request after a quiet
  spell waits 30–60 s.
  *Source:* `docs/superpowers/specs/2026-07-04-public-letter-send-pages-design.md`.
