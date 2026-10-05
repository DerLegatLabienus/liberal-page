# Backlog

The only queue of work for this repo. Open items only — a shipped item is **deleted** (git history
keeps the record), not archived here.

- **IDs** (`LibPage-NNN`) are permanent: never reused, and unchanged when an item is retitled or
  reordered. **Next free ID: LibPage-020** — bump this line whenever an item is added, because
  deleting a shipped item removes its ID from the file.
- **Order is priority:** items appear below in the same order as the lists here.
- **`[loop-safe]`** in a heading marks an item the weekly loop may take. The loop takes the first
  tagged item in this order that has no open or rejected loop PR, and never one in the risky tier
  (migrations, auth and access control, prod data scripts, deploy and CI config).
- **`[risky]`** in a heading or body marks an item in the risky tier. Tag risky items explicitly:
  the loop refuses only items tagged `[risky]` or whose text says "risky tier" — it does not guess
  risk from the wording.
- **"Loop attempt … blocked"** notes inside an item were written by the loop when it could not
  finish: they say why the item was harder or riskier than it looked.

## Now

- **LibPage-001** — Solo developer workflow — two lanes, tiered verification, weekly PR loop

## Next

- **LibPage-002** — Design — Secure the LLM call surface (abuse, injection, and spend)
- **LibPage-018** — The gate does not type-check `server/` or `scripts/`
- **LibPage-003** — Tighten the summarizer to Knesset provenance — verify the document is the one we asked for
- **LibPage-004** — Storage reclaimer — audit and extend for post-2026-06 features
- **LibPage-005** — Knesset Bills Overview — Phase 2 (Recent v2 + extra trending algorithms)
- **LibPage-006** — Multi-channel letters — follow-ups (deferred from the 2026-07-15 channels feature)

## Later

- **LibPage-007** — Code review findings — rolling
- **LibPage-008** — MK list refresh blocks the first request after cache expiry
- **LibPage-010** — Split the `admin` role into granular capabilities
- **LibPage-011** — User Accounts & Alerts
- **LibPage-012** — Live Parliamentary Content Translation
- **LibPage-013** — MK Faction History — Mid-Term Defections
- **LibPage-014** — Database Credential Secret Management
- **LibPage-015** — Entity Dedup on Tracking Add
- **LibPage-016** — Alliance Guilds & Granular User Access
- **LibPage-017** — Site-Wide Product Analytics
- **LibPage-019** — Move the frontend to a host with per-PR previews

---

## LibPage-001 — Solo developer workflow — two lanes, tiered verification, weekly PR loop

**Status:** in progress, designed 2026-10-04. Spec:
`docs/superpowers/specs/2026-10-04-solo-dev-workflow-design.md`. Risky tier (deploy + CI config).

- [ ] 1. Render: deploy only after CI checks pass (done 2026-10-05), PR previews off (done
      2026-10-05), health check path `/api/health` (**still to do, developer, dashboard**)
- [x] 2. Written rules + hygiene (2026-10-04)
- [x] 3. Prune this file, IDs, Now / Next / Later (2026-10-04)
- [ ] 4. Wire the four reviewer briefs into the two PR review workflows (briefs written 2026-10-04)
- [x] 5. `GLOSSARY.md` and the `domain-reviewer` brief (2026-10-04)
- [ ] 6. Weekly scheduled loop, one `[loop-safe]` PR at a time

## LibPage-002 — Design — Secure the LLM call surface (abuse, injection, and spend)

**Status:** design item — nothing to implement until a spec exists.
**Why now:** three Claude call sites exist with uneven protection and **no cost ceiling of any
kind**. The gaps below are real but not on fire; this is hardening, not an incident.

#### Where the calls actually are (verified 2026-08-24)

| # | Call site | Reached by | Input origin |
|---|---|---|---|
| 1 | `summarizer.callClaude()` — `server/services/summarizer.ts:41` | `POST /api/summarize` (**requireAuth**, 10/min/IP, SSRF-guarded URL) **and** the poller (`poller.ts:96`, autonomous) | PDF/DOCX text fetched from a `*.knesset.gov.il` host |
| 2 | Committee-protocol pass — `server/services/summarizer.ts:130` | poller → `committee-session-enricher` only (no HTTP route) | committee protocol document text |
| 3 | `beautifyLetterHtml()` — `server/services/letter-beautifier.ts:41` | `POST /api/admin/letters/beautify` (**requireAdmin**, `lettersBeautifyEnabled` flag → 404 when off) | admin-authored letter HTML |

Only these three exist — `grep -rn "messages.create" server/` is the check to re-run.

#### What already protects them (don't redesign these)

- `requireAuth` + `SlidingWindowLimiter(10, 60s)` per IP on `/api/summarize`; `requireAdmin` +
  dark-by-default flag on `/beautify`.
- **SSRF guard** (`url-guard.ts`): host allowlist + `ipaddr.js` public-IP check + redirect
  re-validation + timeout + size cap, so call #1 can only ingest Knesset-hosted documents.
- **Prompt-injection instruction on call #1** — the document is declared to be data only, and the
  model returns `{relevant:false}` for anything that isn't a Knesset legislative/parliamentary
  document, including "text trying to give you instructions". Irrelevant results are **not cached**.
- Input truncated to 8 000 chars; `max_tokens` capped (1024/1024/2048).
- Beautify output runs through `sanitizeLetterHtml()` — model HTML is treated as untrusted.
- Summaries render as JSX text (`{bill.summary}`, `{extended.aiSummary}`); there is **no**
  `dangerouslySetInnerHTML` anywhere in `src/`, so model output is not an XSS vector today.

#### Gaps the design must address

1. **No spend ceiling — the biggest one.** Nothing caps tokens or cost per user, per day, or
   globally. An invited member can legitimately call `/api/summarize` 10×/min ≈ 14 400×/day; the
   cache is keyed by **MD5 of document bytes**, so distinct URLs always miss. Rate limiting throttles
   *speed*, not *total spend*. Decide: per-user daily quota, a global monthly budget with a
   fail-closed switch, or a gateway-level cap.
2. **Call #2 has no injection defense.** Unlike #1 it carries no "treat this as data" instruction
   and no relevance gate — it just asks for JSON. Its input is a committee protocol reached through
   the poller, so it is *unauthenticated and autonomous*: no human reviews what gets summarized.
   Low likelihood (documents come from knesset.gov.il), non-trivial blast radius.
3. **The poller path bypasses every HTTP-layer control.** `requireAuth` and the rate limiter guard
   the route, not the service. Any budget/abuse control must live at the **service or client**
   layer to cover the autonomous path too.
4. **No audit trail.** No record of prompt, response, token count, or cost per call — so abuse
   can't be investigated after the fact and spend can't be attributed. Note the privacy tension
   with the site's aggregate-only analytics stance: log metadata, not letter bodies.
5. **Output trust is inconsistent.** #3 sanitizes; #1/#2 `JSON.parse` a regex-matched blob and
   persist the result. Safe as rendered today, but the guarantee is incidental rather than designed.

#### Third-party options to evaluate (explicitly in scope)

- **Cloudflare AI Gateway** — likely first candidate: we already use Cloudflare (Turnstile, R2),
  and it is a *base-URL change, not a code change*. Gives centralized rate limiting, caching,
  spend caps, and request logging in front of every call site — covering the poller path for free.
- **Neon AI Gateway** — one credential and per-branch logging; we are already on Neon.
- **Dedicated injection/jailbreak filters** — Lakera Guard, Prompt Security, Rebuff, or an
  open-weight classifier (Llama Guard) as a pre-flight check on document text.
- **Do nothing third-party** — tighten quotas + reuse the existing prompt-hardening pattern from
  call #1 on #2. Cheapest; keeps the free-tier posture and adds no vendor.

Evaluate against the real constraints: Render free tier, small closed user base, no appetite for
paid add-ons (cf. the Resend webhook revert, §3), and "fails closed or no-ops on a missing var".

#### First step

Brainstorm → spec at `docs/superpowers/specs/YYYY-MM-DD-llm-call-security-design.md`. Decide the
spend-cap mechanism first — it is the only gap with an unbounded downside.

## LibPage-018 — The gate does not type-check `server/` or `scripts/` [risky]

Found 2026-10-05 while reviewing the loop scripts. `npx tsc --noEmit` at the repo root reads
`tsconfig.json`, which has `"files": []` and only *references* the app and node configs, so
without `-b` it checks nothing and always exits 0. `npm run build` runs `tsc -b`, which covers
`src/` and `vite.config.ts` only. `tsconfig.server.json` is in neither path, so **server code is
never type-checked** by the local gate or by CI (`test.yml` runs the same command), and `scripts/`
is in no config at all. `CLAUDE.md` says the command checks "both app and server tsconfigs"; it
does not.

Running `npx tsc --noEmit -p tsconfig.server.json` today reports real errors in `server/`
(for example `import.meta` under `module: commonjs` in the DB client, a nullable `status` passed
to a non-null column in the bills repository, a missing declaration for `bidi-js`).

**Fix:** make the server config pass (module setting, the genuine type errors), add `scripts/`
to it, and change the gate and `test.yml` to check all configs (`tsc -b` with the server config
referenced, or an explicit second `-p`). Then correct the `CLAUDE.md` wording. Risky tier: it
changes CI config, and the fixes touch the database client.

## LibPage-003 — Tighten the summarizer to Knesset provenance — verify the document is the one we asked for

**Status:** open. Related to but **separate from** the LLM-call-security design item below: that one
validates output *shape*, this one validates output *provenance* using domain knowledge.

**Problem.** The poller fetches `bill.documentUrl` / a committee session document and summarizes
whatever comes back. Nothing checks that the returned document actually belongs to the entity we
were enriching. The only gate today is `summarizeUrl`'s relevance check — "is this a Knesset
parliamentary document *at all*" — which passes a perfectly genuine protocol from the **wrong
committee** or the **wrong date**.

**Proposal — assert expected-vs-extracted signals before trusting a summary:**

- **Committee identity** — the committee named in a protocol matches the committee whose session
  we are enriching (compare against `committees.name` / the `CommitteeListRepository` cache).
- **Session date** — the date in the document falls within a plausible window of the session's
  `StartDate` from OData.
- **Bill identity** — for bill documents, the bill number/name in the text matches the tracked bill.
- **Knesset number** — matches `knesset_config`'s current value.
- **Attendees are real MKs** — cross-check extracted names against `knesset_members_cache` /
  `mks`; a protocol whose "attendees" are unknown to the Knesset is a strong anomaly signal.

**On mismatch:** do not cache, do not overwrite an existing good summary, log loudly with the
expected-vs-found pair. Mirror the existing `{relevant:false}` path, which already refuses to
persist a bogus doc.

**Why it's worth doing.** Three distinct failures share this one detector:
1. **Injection / document swap** — a hostile or substituted document is far more likely to fail a
   provenance cross-check than a topic classifier, because it must match *specific* facts we
   already independently know, not merely look parliamentary.
2. **Upstream URL-mapping bugs** — a wrong `documentUrl` silently attaches someone else's summary
   to a bill; today nothing would ever surface that.
3. **Data-quality drift** — the same class of problem as the `LastUpdatedDate` incident (§18),
   where trusted-looking upstream data was quietly wrong.

**Design principle to reuse:** the closed-committees spec's *"a flag changes only from positive
confirmation, never from absence of evidence"* — a missing date or unparsed committee name is
**not** a mismatch, it is "unknown", and unknown must not delete or overwrite a good summary.
Only a *positive contradiction* (found committee ≠ expected committee) is a mismatch.

**First step:** measure before enforcing. Log expected-vs-extracted for one poll cycle and see how
often genuine documents fail each check, so thresholds are set against real Knesset formatting
rather than guesses. Enforcement without that measurement risks the same false-positive trap the
`leftover-work-review` skill warns about — a detector that cries wolf gets ignored.

## LibPage-004 — Storage reclaimer — audit and extend for post-2026-06 features

**Status:** open. `server/services/storage-manager.ts` was last touched **2026-06-10**; letters,
channels, share pages, media library, multi-provider login and MK-contact import all landed after
it. Nobody has revisited what it covers since.

**Measured 2026-09-06 (prod Neon):** database is **10.4 MB — 2.3 % of the 450 MB budget**. So the
pipeline has almost certainly **never fired in production**. There is no urgency here; the risk is
that a never-exercised code path does the wrong thing the first time it matters.

**Covered today:** `sent_emails` (Reclaimer 1) · orphan `bills`/`committees`/`mks` + children
(Reclaimer 2) · `refresh_tokens` (poller calls `AuthRepository.deleteExpired`) · `join_analytics`
and `letter_analytics` (self-prune on write).

**Gaps, worst first:**

1. **`magic_link_tokens` leaks — the only live unbounded leak.** Rows are deleted only on *verify*
   (`magic-link.ts:58`). A link that is requested and never clicked stays **forever**, and
   `POST /api/auth/magic-link/request` is a **public** endpoint (rate-limited per IP+email, but
   public). Nothing sweeps expired-unused tokens. Fix is small: an `deleteExpired(now)` alongside
   the existing `refresh_tokens` sweep in the poller.
2. **`summaries_cache` still unbounded** — open since review pass 5 (LibPage-007). Cleaned only
   incidentally when an orphan *committee* is purged (`deleteBySourceUrl`); **bill** summaries are
   never cleaned. Keyed by document MD5, so it only grows.
3. **`committee_sessions` unbounded for *tracked* committees** — rows die only when the whole
   committee is deleted (`deleteCascade`). The committees you actively track are precisely the ones
   that accumulate sessions indefinitely.
4. **R2 object storage is invisible to the mechanism.** `pg_database_size` cannot see it, so letter
   media and share pages never contribute to pressure. Not a leak — `removeShareForLetter` deletes
   both objects on letter delete — but a blind spot: R2 could grow large while Postgres looks fine.

**Also required: prove the pipeline actually fires.** Seed a test database past `limitMb - slackMb`
and assert reclaimers run cheapest-first, re-measure between reclaimers, and stop once under
budget. Unit tests today stub `usedBytes`; nothing exercises the real over-budget path end to end.

**Do NOT fold this into the LLM-call-security spec.** That spec registers its own `llm_call_log`
reclaimer and stops there; this item is a second subsystem and belongs in its own plan.

**Related design principle:** *shed the minimum, hold extracted info as long as possible*
(2026-06-02 storage-pressure spec) — any new reclaimer must slot into the cheapest-first ordering
rather than being appended arbitrarily.

## LibPage-005 — Knesset Bills Overview — Phase 2 (Recent v2 + extra trending algorithms) (Priority: Medium)

Phase 1 shipped the three-tab "Knesset Bills Overview" section (Recent = newest by `BillID desc`, Trending = manual curation, Policy-aligned = keyword match). Phase 2 enhancements, gated behind feature flags stored in the DB (`FeatureFlagsRepository` / `useFeatureFlags`):

- **`recentRanking: "progress"`** — ✅ **Implemented 2026-06-13. Bug-fixed 2026-06-14.** Re-ranks the Recent tab by the most recent committee session appearance (`maxCommitteeSessionID` as recency proxy — verified sequential). Fetches a 200-bill pool, queries `KNS_CmtSessionItem` in chunks of 40 (URL-encoded; Knesset OData returns 400 on unencoded filters and 404 when the URL exceeds ~2000 chars), computes max per bill, re-sorts descending, returns top `limit`. Bills with no sessions sort to the bottom. 30-min cache keyed by Knesset number. Activate by setting the `recentRanking` flag value to `"progress"` in the admin panel. Do NOT use `KNS_Bill.LastUpdatedDate` (administrative-only; surfaced old bills as "recent" in a prior incident). DB migration `0016_recent_ranking_flag.sql` seeds the flag row on existing deployments. Spec: `docs/superpowers/specs/2026-06-13-bills-overview-phase2-design.md`.
- **`trendingAlgorithm: "amendments" | "sponsorship"`** — ✅ **Implemented 2026-06-19.** `fetchTrendingBills(algorithm)` ranks a recent-bill pool by co-sponsor count (`KNS_BillInitiator` rows per `BillID`) or merged-bill count (`KNS_BillUnion` rows per `MainBillID`), surfacing only bills with a signal (count > 0), top 20; mirrors the progress-ranking OData call (chunked/encoded filters, 30-min cache). The `/trending` route reads the `trendingAlgorithm` flag; default `manual` keeps the curated list, so behavior is unchanged until an admin flips the flag in the admin panel. **Caveat (still true):** both signals return empty for recent Knesset 25 bills and accrue over months — the tab will be sparse/empty until the term matures, so leave the flag on `manual` for now. Unit-tested with mocked OData; not yet verified against live data (sparse).
- **Committee name on overview rows** — ✅ Already implemented: `mapRows` in `server/services/knesset-bills.ts` resolves `CommitteeID` → name via `CommitteeListRepository` (in-memory cache, 5 min TTL). Shows `''` only before the poller's first committee-cache refresh — best-effort, not a bug.

Spec: `docs/superpowers/specs/2026-05-26-knesset-bills-overview-design.md`. Phase 1 plan: `docs/superpowers/plans/2026-05-26-knesset-bills-overview.md`.

## LibPage-006 — Multi-channel letters — follow-ups (deferred from the 2026-07-15 channels feature)

Shipped: Email/SMS/WhatsApp channels via compose-assist deep links (spec
`docs/superpowers/specs/2026-07-15-communications-channels-design.md`, plan
`docs/superpowers/plans/2026-07-17-communications-channels.md`). Deliberately deferred:

- **Contract migration (drop legacy `letters` content columns).** `letters.subject/body_html/body_plain/to_addresses/cc_addresses/bcc_addresses` are now empty and unread (content lives in `letter_channels`). Dropping them is a **deploy-ordering hazard**: `scripts/backfill-channels.ts` *reads* them, and prod must run the backfill *between* the expand deploy and the contract deploy — so it can't be single-pushed. Do it as a separate deploy once prod is backfilled: remove the 7 columns from `server/db/schema/letters.ts`, `npm run db:generate`, and retire the backfill script + its test.
- **i18n for the letters UI.** The letters admin composer + member detail page use hardcoded Hebrew (zero `t()` calls, consistent with the pre-existing letters UI). If English support is ever needed for these screens, wire them to `react-i18next` and add `letters.*` keys to `he.json`/`en.json`.
- **Member SMS/WhatsApp sends route through the public endpoint** (`api.letters.publicSend`). Coherent for lifetime totals, but when the `publicSendTurnstile` flag is on, `publicSend` posts an empty token → the authenticated member's send is silently not counted. Consider a member-authed send path for sms/whatsapp, or exempt authed callers from Turnstile.
- **`getForLetter().daily`** would include the `public_sms`/`public_whatsapp` bucket rows among "daily" rows (they aren't `'lifetime'`). Latent only — no live consumer. Fix if a per-letter daily analytics view is ever built.
- **Validate `channel.kind`** against an allowlist at the admin letters create/update API boundary (currently admin-gated and harmless, but a garbage kind falls through to the sms/whatsapp branch).

## LibPage-007 — Code review findings — rolling (Priority: Low–Medium)

Findings from periodic code review passes (speed, security, performance, storage, UX).
Each is small and independent; promote to its own item if it grows.

**Rollup status (pruned 2026-10-04):** every item in the 2026-06-14 "fix now", "next" and
"someday" rollup shipped between 2026-06-15 and 2026-06-19, except the ones listed here.

**Still open from the rollup:**
- `listPublished` pagination (in-memory is fine at current scale).
- Feature-flag gate flash (largely mitigated by the `useFeatureFlags` dedup).
- Split the poller out of the web process (deployment-topology change, unneeded now).
- Per-recipient idempotency for batch email: a partial failure could re-send to recipients who
  already received it; would need a per-recipient ledger.

**The dated passes below are kept verbatim.** They were not re-audited during the prune, so an
individual finding may already be fixed — check the code before working on one.

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

## LibPage-008 — MK list refresh blocks the first request after cache expiry

Follow-up from the 2026-07-20 MK photo fix. The MK-cache refresh resolves photos with **one
header fetch per MK (~132)**, so a stale `GET /api/mks/list` blocks ~85s while it rebuilds. It is
a 24h-TTL background refresh, but the first request after expiry eats the latency. Consider moving
the rebuild into the poller (background), or a bulk image source (e.g.
`Faction/GetFactionDetails` returns MKs with `ImagePath` in far fewer calls).

## LibPage-010 — Split the `admin` role into granular capabilities

Today there's one blanket `admin` role. As the team grows, break it into capability-scoped roles —
e.g. **letter manager**, **Knesset-tracker editor**, **feature-flag editor** — so a contributor can
be granted just what they need. The first seam already exists: **`canManageLetters(user)`**
(`src/lib/permissions.ts`) gates the letters-management surface (route guard + `UserMenu` entry +
`LettersModeTabs`) — widen that one function (and add sibling `can*` helpers) instead of scattering
`role === 'admin'` checks. Needs: a role/capability model (roles table or a capability set on the
user), the invite/role admin UI, and switching the remaining `role === 'admin'` guards to capability
checks.

## LibPage-011 — User Accounts & Alerts (Priority: Low)

Member login, personalized tracking lists, email alerts on bill status changes.
Requires database (item 2 above) and an email service.

### 🔲 Open — Webhook-based real-time delivery status (requires paid Resend plan)

We initially built a log-only delivery webhook (`POST /api/webhooks/resend`, svix-verified) but
**reverted it** because Resend gates webhooks behind a paid plan; delivery status is pulled
instead (see above). If/when the account is upgraded, the webhook gives near-real-time status
(vs. the up-to-6h polling lag) and removes the per-cycle retrieve calls. The implementation is
preserved in git at commit `caaa8f9` (revert) — restore `server/routes/webhooks.ts`, its test,
the `svix` dep, the `express.json()`-ordering mount in `server/index.ts`, and the
`RESEND_WEBHOOK_SECRET` env var; then register the endpoint in the Resend dashboard. Polling and
the webhook can also coexist (webhook for freshness, poll as backfill).

## LibPage-012 — Live Parliamentary Content Translation (Priority: Low)

Parliamentary content items (bill titles, MK names, committee names, activity descriptions) are stored as plain Hebrew strings from the Knesset API. No English source exists.

**Requirements:**
- Each parliamentary data item carries a stable identity (its Knesset numeric ID)
- A translation cache maps `{ id → { he: string, en: string } }` — stored alongside the existing JSON data
- On first English-mode view, translations are requested (via LLM or translation API) and written to the cache
- Components check the cache before falling back to the raw Hebrew string
- The cache is persisted between server restarts
- Depends on: item 2 (database) for long-term cache storage

## LibPage-013 — MK Faction History — Mid-Term Defections (Priority: Low)

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

## LibPage-014 — Database Credential Secret Management (Priority: Low)

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

## LibPage-015 — Entity Dedup on Tracking Add (Priority: Low)

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

## LibPage-016 — Alliance Guilds & Granular User Access (Priority: Low)

Currently all `allowed_emails` users are a single homogeneous cell. Future work to differentiate access levels:

- **Guild/tier model:** distinguish core cell members from allied organizations or partner groups, each with configurable access scopes (e.g., a guild can view letters but not the parliament tracker, or vice versa)
- **Quick-block mechanism:** admin can suspend a previously-authorized user without deleting them from the allowlist — revokes active refresh tokens immediately without requiring email removal. Useful when someone leaves the group but admin doesn't want to lose the invite history
- **Scope propagation:** gated features (letters, tracker, etc.) check guild membership, not just presence in `allowed_emails`

This is a prerequisite for any cross-organization collaboration feature. Design separately when a specific alliance use case emerges.

## LibPage-017 — Site-Wide Product Analytics (Priority: Low — Advanced)

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

## LibPage-019 — Move the frontend to a host with per-PR previews [risky]

Added 2026-10-05. Today the frontend is one GitHub Pages site built from `master`, so a pull
request (in particular one from the weekly loop) can only be judged from its diff. A static host
that builds a preview per pull request (Cloudflare Pages, Netlify, Vercel, Render static sites)
would give each PR a URL to look at. Static files carry no secrets, so this is the safe half of
"an environment per PR". Cloudflare Pages is the natural candidate since R2 and Turnstile already
live there; free-tier terms were not checked.

**Limits to design around:**
- A preview frontend still calls the live backend (backend previews are off, see
  `docs/research/2026-10-05-render-pr-previews-with-neon-branches.md`). The backend's allowed
  origin would have to accept preview URLs.
- Google sign-in only works from registered origins, so signed-in flows cannot be tried on a
  preview.
- Previews show live data.

**Migration cost:** the site address changes and the `/liberal-page/` base path goes away; the
backend's `CORS_ORIGIN` and `PUBLIC_SITE_URL`, the Google OAuth origins, and `deploy.yml` all
change; existing share pages and sent emails link to the old address, so it must keep working or
redirect.

**When:** after the weekly loop has produced a few PRs and seeing them rendered is actually
missed. Risky tier (deploy config): spec, plan, confirmed push.
