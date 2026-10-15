# Non-functional requirements

## What belongs here

A non-functional requirement (NFR) is **a quality the whole system keeps, whatever the
feature**. An item is on this page only if:

1. **it applies to any change**, not to one feature;
2. **a reviewer can check a diff against it**;
3. **it says what must hold, not how it is built.** Numbers, file names and inventories live in
   the document that describes the how, and the item points there.

What goes elsewhere:

| Kind of rule | Where it lives |
|---|---|
| How the system meets a requirement: limits, timeouts, caches, rate-limit values, file names | `docs/architecture.md` (mainly **Limits and safeguards**) |
| How UI meets a requirement: tokens, components, RTL mechanics, accessibility details | `docs/design-system.md` |
| How we work: production access, deploys, migrations on boot, the loop's database window | `CLAUDE.md` |
| One feature's behaviour | Its spec in `docs/superpowers/specs/` |

A plan's **Fit** line and a reviewer cite these items by ID (for example `SEC-4`, `PRIV-1`).
This page records decisions already made. **Known gaps** are things the sources admit are
missing, listed so a plan does not assume they exist.

---

## 1. Security

- **SEC-1. Every route states who may call it**: public, `requireAuth`, `requireAdmin` or
  `optionalAuth`. *How:* `CLAUDE.md` (Backend API table).
- **SEC-2. Every sign-in passes the one invite gate** (`loginWithIdentity` and the allowlist). No
  front door skips it. *How:* `docs/architecture.md` (Auth & multi-user).
- **SEC-3. An email is trusted only when its provider has verified it** (nOAuth mitigation).
  *How:* `docs/superpowers/specs/2026-07-07-multi-provider-login-design.md` (Security
  considerations).
- **SEC-4. Tokens are short-lived, or stored only as a hash.** *How:* `docs/architecture.md`
  (Limits and safeguards; Auth & multi-user).
- **SEC-5. A public endpoint never reveals who is a member.** *How:* `docs/architecture.md`
  (Auth & multi-user: the magic-link request always answers `200`).
- **SEC-6. Dev-only shortcuts cannot run in production**, enforced in code, not by convention.
  *How:* `server/services/auth-providers/dev.ts`, `CLAUDE.md` (Local full-stack dev).
- **SEC-7. A server-side fetch of a URL that a user can influence goes through the URL guard.**
  *How:* `docs/architecture.md` (Limits and safeguards), `server/services/url-guard.ts`.
- **SEC-8. HTML that users or the AI write is sanitised on the server before it is stored**, and
  rendered only from that stored, sanitised copy. *How:* `server/services/html-sanitizer.ts`,
  `CLAUDE.md` (Letter & template HTML).
- **SEC-9. An upload is checked by its bytes, not its declared type, and has a size cap.**
  *How:* `docs/architecture.md` (R2 Media).
- **SEC-10. Values put into email templates are escaped** unless explicitly marked raw.
  *How:* `docs/architecture.md` (Email).
- **SEC-11. Clients never see a stack trace.** *How:* `server/index.ts` (final error handler).
- **SEC-12. CORS is an allowlist; any open-CORS route is named and justified.** *How:*
  `docs/architecture.md` (Public Share Pages: the send beacon).
- **SEC-13. Secrets live only in environment variables**, never in the repo or in client code.
  *How:* `.env.example`, `docs/architecture.md` (R2 Media, Public Share Pages).

**Known gaps**

- The LLM call surface has an approved design that is not built: one chokepoint for
  `@anthropic-ai/sdk`, injection defence on the poller's unattended path, an audit log and
  daily ceilings. Today the poller's summarise calls skip the route's auth and rate limit, and
  nothing caps total volume. *Source:*
  `docs/superpowers/specs/2026-09-06-llm-call-security-design.md` (The actual gaps).

---

## 2. Privacy

- **PRIV-1. Logs carry no personal data**: no email addresses, phone numbers, names of private
  people, tokens, letter or draft bodies, or request bodies. Use an internal ID instead.
  *How:* `docs/architecture.md` (Email: `redactEmail`).
- **PRIV-2. Public pages carry no member data.** *How:* `docs/architecture.md` (Public Share
  Pages), `docs/superpowers/specs/2026-06-20-public-share-pages-design.md` (Privacy & security).
- **PRIV-3. Public analytics are anonymous counters**, kept apart from member engagement.
  *How:* `docs/architecture.md` (Public Share Pages).
- **PRIV-4. Keep only the personal data a feature needs, and bound how long it stays.** *How:*
  `docs/architecture.md` (Meet Us stores no identity; Email ledger; Poller storage reclaimer).

---

## 3. Logging and monitoring

- **LOG-1. Log lines name events and identifiers, not content** (and see PRIV-1). Logs are the
  server's console as read on Render, or the browser console. *Source:*
  `docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md` (Logging).
- **LOG-2. Best-effort side work logs its failure and never blocks the main action.** *How:*
  `docs/architecture.md` (Poller, Email, Public Share Pages).
- **MON-1. `/api/health` is the liveness signal.** *How:* `CLAUDE.md` (Git & Deploy Workflow).
- **MON-2. A change says how its failure would be noticed**, and uses an existing signal before
  it adds a metric. *How:* `docs/architecture.md` (Limits and safeguards: signals recorded
  today), `docs/superpowers/specs/2026-10-14-loop-plan-and-proof-design.md` (Monitoring,
  Metrics).

**Known gaps**

- Nothing alerts anyone. A failure is noticed in Render's logs, by the health check stopping a
  deploy, or by a user.

---

## 4. Performance

- **PERF-1. Slow external work stays off the request path**: it is cached in Postgres or done by
  the background poller. *How:* `docs/architecture.md` (Limits and safeguards: caches; Poller).
- **PERF-2. Pages that strangers open do not wait on the backend.** *How:*
  `docs/architecture.md` (Public Share Pages), and see AVAIL-4.
- **PERF-3. An optional or native module cannot slow or break server boot**: it loads lazily.
  *How:* `docs/architecture.md` (Public Share Pages, DB Module).

---

## 5. Accessibility

- **A11Y-1. Every UI change meets the accessibility floor**: keyboard, real semantics,
  contrast, reduced motion, and phone width. *How:* `docs/design-system.md` §8, §9.

---

## 6. RTL and language

- **RTL-1. Every user-facing page works in Hebrew right-to-left, and public text can be
  translated.** *How:* `docs/design-system.md` §5, §7; `docs/architecture.md` (Directionality).
- **RTL-2. Letter content is always Hebrew right-to-left, wherever it is shown; admin tools are
  English left-to-right.** *How:* `docs/design-system.md` §5.

---

## 7. Cost

- **COST-1. Free tiers first.** *Source:*
  `docs/superpowers/specs/2026-05-30-database-migration-design.md` (Why Drizzle + Neon),
  `docs/portfolio-review.md` (Infrastructure and cost constraints).
- **COST-2. The database keeps itself inside its size budget**, without deleting what users
  track. *How:* `docs/architecture.md` (Poller: storage reclaimer).
- **COST-3. Each LLM call costs money**, so calls are cached, rate-limited and, where an admin
  triggers them, behind a flag. *How:* `docs/architecture.md` (Limits and safeguards).

**Known gaps**

- The LLM daily ceilings in the approved design are not built (see Security, Known gaps).

---

## 8. Availability

- **AVAIL-1. A missing integration degrades; it does not crash the server.** *How:*
  `CLAUDE.md` (Local full-stack dev — what's real vs. faked).
- **AVAIL-2. A gate that cannot check fails in a direction chosen on purpose**: closed where a
  wrong yes is unsafe, open where a wrong no would silently lose data. *How:*
  `docs/architecture.md` (Limits and safeguards: failure modes).
- **AVAIL-3. One backend instance.** In-memory state (rate limits) is per instance and lost on
  restart; that is accepted while there is one instance. *How:* `docs/architecture.md` (Limits
  and safeguards).
- **AVAIL-4. Shared links stay up when the backend sleeps**: the frontend is static on GitHub
  Pages and share pages are served from R2. *How:* `CLAUDE.md` (Infrastructure & Tooling Map),
  `docs/architecture.md` (Public Share Pages).

**Known gaps**

- The backend is on Render's free tier and sleeps when idle: the first request after a quiet
  spell waits 30–60 s. *Source:*
  `docs/superpowers/specs/2026-07-04-public-letter-send-pages-design.md`.
