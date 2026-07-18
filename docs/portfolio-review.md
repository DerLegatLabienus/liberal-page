# Liberal Page — Project Review & Backend Portfolio

> Generated 2026-07-18 by the `/portfolio-review` project skill. Regenerate after major
> milestones so the stats and stories stay current.

## What the project is

**Liberal Page** — a Hebrew-first (RTL) civic-engagement platform for a liberal political
movement in Israel. Members track Knesset bills, committees, and MKs in real time, get AI
summaries of committee protocols, send advocacy letters to representatives, and book meetings.

Built solo: **617 commits since May 2026, ~13,000 lines of TypeScript across 309 files,
133 test files, 28 DB migrations, 16 API route modules, and 44 written design specs.**

## Architecture points

- **Layered backend**: Express 5 with a clean route → service → repository split. ~35 services
  (Knesset API clients, poller, summarizer, email, share publishing, sanitization) and one
  repository class per domain — no data access leaks into routes.
- **Domain-driven database**: 28 Postgres tables organized into **6 domain schemas**
  (`parliament`, `auth`, `email`, `letters`, `analytics`, `config`) by low-coupling /
  high-cohesion, with deliberate, minimal cross-schema foreign keys. Drizzle ORM, 28 versioned
  migrations applied idempotently on boot.
- **One driver, three environments**: `node-postgres` serves both local Docker Postgres and Neon
  (switch = one `.env` line); tests run against **in-memory pglite** so the full suite needs no
  database or network.
- **Data-ingestion pipeline**: a resilient 6-hour poller with exponential backoff that reconciles
  data from three different external Knesset APIs (oknesset REST, Knesset OData, and the
  bot-protected Knesset website), handles the SiteId↔KnsID identity-mapping problem, enriches
  committee sessions, and sends per-member bill-status email digests.
- **Self-managing storage**: an automatic storage-pressure reclaimer that measures
  `pg_database_size` and runs a cheapest-first pipeline (trim email ledger → purge orphaned
  untracked entities), re-measuring between steps — capacity ops encoded as code.
- **Auth built from primitives, not a SaaS**: multi-provider login (Google ID tokens, magic links
  via email, a dormant-but-tested Microsoft adapter) funneling through one `loginWithIdentity`
  gate with an invite allowlist. Sessions are short-lived JWTs plus **rotating refresh tokens
  stored as sha256 hashes — reuse of a rotated token revokes all sessions**. Role-based access
  (admin/member/group) and personal-vs-group tracking scopes.
- **Security engineering throughout**: an SSRF guard for server-side document fetches (host
  allowlist + `ipaddr.js` public-IP check + redirect re-validation + size caps), strict-allowlist
  HTML sanitization for admin-authored content, per-IP/per-email rate limiting, Cloudflare
  Turnstile bot verification (fail-open by design so a misconfig can't zero metrics), and
  nOAuth-aware provider verification (verified-email enforcement; Microsoft intentionally
  disabled until `xms_edov` is available).
- **Static-page generation pipeline**: published letters get standalone public share pages on R2 —
  server-rendered HTML with OG/Twitter meta plus a branded 1200×630 OG card rendered via
  satori + resvg, including **manual bidi reordering of Hebrew text** because satori has no RTL
  support. Fire-and-forget publishing so a share failure never blocks an admin save.
- **Ops-aware design**: feature flags in the DB gating every risky surface (dark-merge friendly),
  fire-and-forget analytics with public/member bucket separation, email delivery-status polling
  against Resend, an outbound-fetch logger, and documented deploy ordering (seed before serving
  traffic).

## Technology stack

| Layer | Technologies |
|---|---|
| Backend | Node 22, Express 5, TypeScript 5.6, tsx |
| Database | Postgres (Neon prod / Docker local), Drizzle ORM, pglite for tests |
| Frontend | React 18, Vite, Tailwind, shadcn-style primitives, react-i18next (Hebrew/English, RTL-first) |
| Auth | jose, google-auth-library, jsonwebtoken, MSAL (dormant) |
| AI | Anthropic API — relevance-gated summarization of committee protocol PDFs/DOCX (pdf-parse, mammoth), MD5-keyed result caching |
| Testing | Vitest + Testing Library + supertest, 133 test files, parallelized CI |
| Infra/services | GitHub Pages (frontend CI deploy), Render (backend), Neon, Cloudflare R2 (S3 SDK) + Turnstile, Resend (email), Calendly API |

## What it demonstrates as a backend engineer

1. **A real migration, executed** — JSON-file storage → fully normalized Postgres, in two planned
   phases, non-destructively, with a written design spec, while the site stayed live. The single
   strongest backend story here.
2. **Design before build** — 44 dated design specs covering everything from poller backoff to
   domain schemas. A senior habit most solo projects lack.
3. **Thinking in failure modes** — backoff, isolation of email from poll success, fail-open
   Turnstile, lazy-loading native bindings so they can't crash boot, atomic invite-send-then-write.
   Concrete answers to "what happens when X is down."
4. **Auth built correctly from scratch** — token rotation with reuse detection, hashed storage,
   allowlist gating, provider verification pitfalls (nOAuth). Interviewers probe this area hard.
5. **Systems integration under hostile conditions** — three inconsistent government APIs, an
   ID-mapping join table, a bot-protected site, and RTL/bidi rendering. Messy real-world
   integration, not a tutorial CRUD app.
6. **Running production** — CI-gated deploys to two platforms, DB seeding/ordering discipline,
   storage budgets, feature-flagged rollouts, analytics. Full lifecycle ownership.

## Technical issues seen and solved

### Security issues found and fixed

- **SSRF in the summarizer** — `POST /api/summarize` originally fetched any caller-supplied URL
  server-side, unauthenticated. An attacker could point it at internal services or cloud metadata
  (`169.254.169.254`) and burn Anthropic API credits. Fixed with a dedicated `url-guard`: host
  allowlist, private/loopback IP rejection *after DNS resolution*, redirect re-validation,
  timeout, size cap — plus `requireAuth`, rate limiting, and relevance-gating on the AI call.
- **nOAuth vulnerability class** — OAuth logins now require provider-*verified* email ownership
  (Google `email_verified`, magic-link by delivery). Microsoft login was deliberately left
  disabled because safe support requires the `xms_edov` claim; the adapter is kept dormant and
  tested as the re-enabling blueprint. Knowing when *not* to ship a provider is the strong part.
- **Magic-link hardening** — made the request path constant-time (no email-existence oracle) and
  token consumption atomic and single-use, closing both a timing leak and a redeem race.
- **Refresh-token rotation race** — concurrent refresh calls (multiple tabs) triggered the
  reuse-detection logic and wiped the user's own session. Fixed by deduplicating in-flight
  refresh calls client-side, and syncing session state across tabs via `BroadcastChannel`.

### Hostile external API problems

- **Knesset OData quirks** — unencoded `$filter` strings return 400, and URLs over ~2000 chars
  return 404. Solved by chunking filter queries into batches of 40 IDs and URL-encoding
  everything.
- **A real data-quality incident** — `KNS_Bill.LastUpdatedDate` turned out to be
  administrative-only, surfacing years-old bills as "recent." Replaced with
  `maxCommitteeSessionID` as a verified-sequential recency proxy, and the lesson is documented in
  the backlog so it can't recur.
- **Ambiguous committee terms** — the OData `IsCurrent` flag matched arbitrarily across committee
  terms; fixed by resolving the newest term explicitly.
- **Dead upstream dependency** — the parliament read path was making live calls to defunct
  oknesset.org endpoints on every request, making the API slow; cut over to serving from the
  local store.
- Plus the standing SiteId↔KnsID identity-mapping problem and query `$top` truncation fixes.

### RTL / Hebrew rendering

- **satori has no bidi support** — Hebrew text in the generated OG share cards rendered
  backwards. Solved by pre-reordering strings to visual order with `bidi-js` before handing them
  to satori. A genuinely obscure problem with a clean fix.
- A family of smaller RTL/i18n bugs: forced-LTR admin surfaces, `dir=rtl` inconsistencies,
  hardcoded Hebrew leaking into the English page.

### Infrastructure and cost constraints

- **Resend webhooks are paywalled** — built a svix-verified delivery webhook, discovered the plan
  gating, and *reverted it cleanly* in favor of a pull-based delivery-status poller (capped,
  oldest-first, isolated from poll success). The webhook implementation is preserved in git for
  when the plan upgrades — a textbook cost-driven architecture pivot.
- **Database size budget** — running on a small Neon tier meant unbounded growth (email ledger,
  orphaned untracked entities) would hit the limit. Built the automatic storage-pressure
  reclaimer instead of doing manual cleanup.
- **CORS from a foreign origin** — the R2-hosted public share pages send analytics beacons to the
  API from a different origin; the app's allowlisted CORS blocked them. Fixed by mounting a
  permissive `cors()` on just the public send route *before* the global middleware.
- **Migration ordering trap** — the domain-schema migration had to be sequenced after an earlier
  migration containing an unqualified `INSERT INTO letter_contacts`, and Drizzle's snapshot JSON
  had to be regenerated via `drizzle-kit/api` so future diffs stay correct. Verified on a Neon
  branch dry-run before touching prod.

### Self-found via systematic code review

A distinctive habit: **seven structured review passes** over the codebase (read paths, poller,
auth surfaces, frontend perf, DB indexes, email, HTTP hardening), findings logged in the backlog.
That process caught, among others:

- N+1 queries on the hot parliament read path
- **Unindexed `refresh_tokens.token_hash`** — a full table scan on the hottest auth path (fixed
  in migration 0019 along with other FK indexes, since Postgres doesn't auto-index FKs)
- The summarizer re-downloading every document each cycle just to compute its cache key
- Deploy workflow not gated on CI tests; missing `helmet`; no graceful shutdown

Some are fixed, some consciously deferred with rationale — itself a good talking point about
prioritization.

### Frontend bugs worth a mention

- The homepage panorama's auto-advance was calling focus/scroll logic that **yanked the page into
  view** mid-read — fixed, along with hover-pause behavior.
- Auth session restore raced page-access gating (members saw a flash of "no access" before their
  session loaded) — fixed by awaiting restore before gating.
- An open, documented shadcn theming bug (`bg-primary` rendering transparent) sits in the
  backlog — known issues tracked honestly.

## Technical glossary — concepts in context

Every term below is anchored to a concrete place in this repo. Each row doubles as a ready
interview answer to "have you worked with X?" — say the term, then the anchor.

### Security & auth

| Term | How it fits this project |
|---|---|
| SSRF (server-side request forgery) | `server/services/url-guard.ts` guards the summarizer's document downloads: host allowlist, private/loopback IP rejection after DNS resolution, redirect re-validation, timeout, size cap |
| Allowlist over denylist | Applied twice: doc-fetch hosts (`*.knesset.gov.il`) and the invite-only `auth.allowed_emails` account gate |
| JWT bearer authentication | Short-lived (15-min) access tokens checked by `requireAuth`/`requireAdmin`/`optionalAuth` middleware; role claim rides in the token |
| Refresh-token rotation & reuse detection | Tokens stored as sha256 hashes in `auth.refresh_tokens`; replaying a rotated token revokes all of the user's sessions |
| OIDC / JWKS verification | Provider ID tokens verified server-side against the provider's live JWKS via `jose` (`iss`/`aud`/`exp`), adapters in `server/services/auth-providers/` |
| nOAuth | Login requires provider-*verified* email ownership; Microsoft kept disabled until the Entra `xms_edov` claim is maintained — the dormant adapter is the re-enabling blueprint |
| Magic link | Hashed, single-use, 15-minute sign-in token emailed via Resend — delivery itself proves address ownership |
| Timing attack / constant-time code | The magic-link request path runs constant-time so response latency can't leak whether an email is registered |
| User enumeration | The same endpoint always returns a neutral `200`, invited or not |
| Sliding-window rate limiting | `server/services/rate-limit.ts` — per-IP and per-(IP, email) limits on auth, booking, and paid-AI endpoints |
| RBAC (role-based access control) | `admin` / `member` / internal `group` roles; personal vs. group tracking scopes enforced per route |
| XSS / HTML sanitization | Admin-authored letter HTML passes `server/services/html-sanitizer.ts` (strict allowlist) before storage, because it's later opened in scriptable contexts |
| Magic-byte (content) sniffing | Letter image uploads are byte-sniffed raster-only in `image-validator.ts` — the declared MIME type is never trusted |
| Fail-open vs. fail-closed | A deliberate fail-open: missing `TURNSTILE_SECRET_KEY` still counts public sends, so a misconfig can't silently zero the metric |
| CAPTCHA / bot mitigation | Cloudflare Turnstile interstitial on the public share pages; token verified server-side via `siteverify` |

### Data & persistence

| Term | How it fits this project |
|---|---|
| Repository pattern | One class per domain in `server/repositories/` — routes and the poller never touch SQL directly |
| ORM / schema-as-code | Drizzle schema per domain in `server/db/schema/`, single source for DDL and query types |
| Versioned, idempotent migrations | 28 SQL migrations applied automatically on boot, tracked in `__drizzle_migrations` — safe to re-run |
| Normalization & aggregate reassembly | An MK read joins `mks` + terms + roles + activity + votes and derives `party`/`inactive` — normalized storage, typed aggregate out |
| Bounded contexts / domain schemas | 28 tables grouped into 6 Postgres schemas (`parliament`, `auth`, `email`, `letters`, `analytics`, `config`) by low coupling / high cohesion, moved non-destructively via `ALTER TABLE … SET SCHEMA` |
| Upsert | `/api/tracking/add` upserts the entity, then the per-user tracking row |
| N+1 query problem | Found in the parliament read path during self-review (per-entity `getById` fan-out); fix pattern: batch with `inArray` + in-memory grouping |
| FK indexing | Postgres doesn't auto-index foreign keys — migration 0019 added the missing hot indexes, including `refresh_tokens.token_hash` on the hottest auth path |
| Connection pooling | One `node-postgres` `Pool` serves local Docker and Neon; SSL decided by the connection string, not the driver |
| Content-addressed caching | AI summaries cached in `summaries_cache` keyed by document MD5 — identical content never pays for a second Claude call |
| TTL cache / refresh-on-stale-read | Knesset member & committee list caches (6 h) refreshed lazily when a read finds them stale |
| Anti-join | Orphan reclamation finds entities no user tracks via anti-joins on the tracking tables — multi-user safe |
| Hermetic tests | The whole suite runs on in-memory pglite — no database, no network, parallelizable in CI |
| Single source of truth | `src/types.ts` is the one shape definition shared by frontend and server |

### Resilience & operations

| Term | How it fits this project |
|---|---|
| Exponential backoff | Poller total-failure backoff: 1 min doubling up to 10 min, then the normal 6 h interval on recovery |
| Polling vs. webhooks | Resend delivery status is *pulled* each cycle after the svix-verified webhook was reverted (paywalled) — the trade-off is a known freshness lag, implementation preserved in git |
| Fire-and-forget | Share-page publishing and analytics beacons never block or fail the primary write; errors are logged, not surfaced |
| Bulkhead / failure isolation | Email digests and delivery polling run inside their own try/catch so email problems can never fail a poll cycle |
| Graceful degradation | Every optional integration degrades cleanly: unset provider → 503 + hidden button; R2 unconfigured → media routes 503, share publish no-ops |
| Feature flags / dark launch | DB-backed `feature_flags` gate risky surfaces; `publicSharePages` was dark-merged off and enabled in prod by flag flip |
| Capacity management as code | The storage-pressure reclaimer runs a cheapest-first pipeline against a `pg_database_size` budget, re-measuring between reclaimers |
| Deploy ordering | Documented invariant: seed the DB before serving traffic; migrations auto-apply on boot; the domain-schema migration got a Neon-branch dry-run first |
| Trunk-based development | Solo work directly on `master`; a four-command gate (test, tsc, lint, build), then push — and push *is* deploy (GitHub Pages + Render) |

### Web platform & i18n

| Term | How it fits this project |
|---|---|
| CORS | Global allowlisted CORS, plus a permissive `cors()` mounted *before* it on the one public route that receives beacons from R2-hosted pages — middleware order as the fix |
| OData | Knesset's query protocol, with hard-won rules: URL-encode `$filter`, chunk ID lists to 40 per request, stay under the ~2000-char URL limit |
| Unicode bidi (logical vs. visual order) | satori can't do bidi, so Hebrew strings are pre-reordered to visual order with `bidi-js` before OG-card rendering |
| RTL-first i18n | Hebrew is the primary language; direction lives on `document.documentElement.dir`, read via `useDirection()`; some sections render only in Hebrew |
| Static site generation | Each published letter is rendered to a standalone HTML + OG PNG pair and published to R2 — per-entity SSG with a `letters:regen` backfill script |
| Open Graph / Twitter Cards | Share pages carry OG/Twitter meta plus a branded 1200×630 card rendered by satori + resvg (lazy-imported so a native-binding failure can't kill boot) |
| `navigator.sendBeacon` | Public send pages report mailto/gmail/copy actions via beacons — fire-and-forget from the browser side too |
| `BroadcastChannel` | Syncs login/logout across browser tabs after the refresh-race fix |
| SPA + dev proxy | Vite serves the React SPA and proxies `/api/*` to Express — one origin in dev, no CORS friction locally |

### AI engineering

| Term | How it fits this project |
|---|---|
| LLM summarization with relevance gating | Committee protocols (PDF/DOCX) are summarized by Claude only after a relevance check, so irrelevant documents don't burn tokens |
| AI cost & abuse control | The paid surface is fenced three ways: auth required, per-IP rate limit, MD5-keyed result cache — and the SSRF guard keeps it from fetching arbitrary URLs |
| AI-assisted content editing | Admin "beautify" cleans letter HTML via Claude, feature-flagged and sanitized on output |

### Testing & process

| Term | How it fits this project |
|---|---|
| Spec-driven development | 44 dated design specs in `docs/superpowers/specs/` — written before implementation, referenced from BACKLOG entries |
| Integration testing | `supertest` drives the real Express app against pglite — routes, middleware, and repositories exercised together |
| Auto-mocking | `react-i18next` auto-mocked for component tests via `src/__mocks__/react-i18next.ts` |
| Environment parity | The same driver and migrations run in dev (Docker), prod (Neon), and tests (pglite) — parity by construction, switched by one env var |
| CI gating | Lint + typecheck + tests + build on every push; the gap (deploy workflow not `needs:`-gated on CI) was itself found in a self-review pass |
| Rolling self-review | Seven structured review passes over the codebase with findings triaged into BACKLOG — fixed or consciously deferred with rationale |

## Framing tips for interviews

- Lead with the **data pipeline + Postgres migration + auth system** trio and the scale numbers;
  present the AI summarization as a supporting feature — it shows range, but the backend
  fundamentals are the differentiator.
- The four strongest problem-solving stories: **SSRF hardening**, the **refresh-token race**, the
  **Resend webhook revert** (cost-driven pivot with a preserved implementation), and the
  **LastUpdatedDate data-quality incident** — each has a clear
  problem → investigation → fix → lesson arc.
