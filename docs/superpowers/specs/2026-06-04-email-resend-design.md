# Email via Resend — Invitation Emails + Bill-Status Alerts

**Date:** 2026-06-04
**Status:** Approved design
**Backlog:** #3 (multi-user accounts) — alerts half (#3b)

## Goal

Add a transactional email capability over a single shared sender (Resend) serving two use cases:

1. **Invitation emails** — sent when an admin adds an email to the allowlist.
2. **Bill-status alert digests** — sent to members when a bill they personally track changes status.

Email is a best-effort side channel: a send failure must never break the API call or poll cycle that triggered it. Templates are **stored in the database** and editable by admins; **per-email delivery status is persisted** via Resend webhooks.

## Decisions (locked)

- **Provider:** Resend (deps: `resend`, `svix` for webhook signature verification).
- **Alert recipients:** personal trackers only. Group-list-only bills do not generate alerts (the group account has no email).
- **Opt-out:** per-user toggle `users.email_alerts`, **default on**.
- **Batching:** **one digest email per member per poll cycle**, grouping all of that member's changed bills.
- **Delivery semantics:** fire-and-forget toward the trigger. Sends are recorded in a **minimal `sent_emails` ledger** (`sent`/`failed`, set once). Delivery lifecycle (delivered/bounced/…) is **logged only** via the webhook — never stored.
- **Logging/privacy:** every email log line redacts the address to its local part (`avivavitan63@…`, domain dropped) and carries the Resend message id for full lookup in the Resend dashboard. No other PII logged.
- **Storage pressure:** the `sent_emails` ledger is wired into a generalized reclaimer pipeline and is the **first thing trimmed** when the DB is over budget.
- **Invite re-sends:** the invite email fires on **every** `POST /api/admin/invites`, including re-invites.
- **Toggle placement:** inside the signed-in `AuthControl` area.
- **Templates:** stored in DB (`email_templates`), edited via the admin panel, rendered through one generalized `renderTemplate(name, params)` with `{{placeholder}}` substitution and a shared layout/style wrapper.
- **Throttle:** digest sends are spaced to stay within Resend's 2 req/s default.

## Context (verified in code)

- Poller interval `POLL_INTERVAL_MS` default **6 h** (`server/services/poller.ts:15`). Digests therefore at most every 6 h.
- Bill status is the full Knesset vocabulary from `KNS_Status` (`TypeID eq 2`, `Desc`) via `getBillStatusMap` — **not** the 4-value union currently declared at `src/types.ts:16`. The poller detects change by string inequality and writes the new status the same cycle (natural dedup; a missing lookup returns `null` → "no change", no false alerts).
- Resend limits: default **2 requests/second** per account; free plan 100/day, 3,000/month (sufficient for a small closed group on a 6 h cycle).
- Migrations are at `0011`; new ones start at `0012`. Flat-table repos follow the `FeatureFlagsRepository` upsert pattern.

## Architecture

```
 admin POST /invites ─┐                          ┌─ email_templates (DB, cached)
                      ├─▶ sendEmail({to,         │
 poller pollBills ────┘     template, params}) ──┼─▶ renderTemplate(name,params)
   (throttled digest)                            │     = layout(_layout) + body(name)
                                │                 └────────────────────────────────
                                ▼
                        getResend() ──▶ Resend API ──▶ {id} or {error}
                                │
                                ▼ record (minimal, prunable ledger)
                        sent_emails (id, to, template, status='sent'|'failed')
                                          │ trimmed first under storage pressure

 Resend webhook ──▶ POST /api/webhooks/resend (svix-verified)
   (delivered / bounced / complained / delayed) ──▶ SERVER LOG ONLY, stores nothing
       e.g.  [email] delivery event=bounced to=avivavitan63@… msgId=re_abc123
```

## Schema changes

`server/db/schema/` gains a new file `email.ts` (exported from `index.ts`); `users` gains a column in `tracking.ts`.

### `users.email_alerts`
```ts
emailAlerts: boolean('email_alerts').notNull().default(true),
```
(import `boolean` from `drizzle-orm/pg-core`).

### `email_templates`
```ts
export const emailTemplates = pgTable('email_templates', {
  name: text('name').primaryKey(),          // 'invite' | 'bill_digest' | 'bill_digest_item' | '_layout'
  subject: text('subject').notNull().default(''),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
```

### `sent_emails` (minimal send ledger — recorded at send, never updated)
```ts
export const sentEmails = pgTable('sent_emails', {
  id: text('id').primaryKey(),              // Resend message id (or 'failed:<uuid>' on send error)
  toEmail: text('to_email').notNull(),
  template: text('template').notNull(),
  status: text('status').notNull().default('sent'), // 'sent' | 'failed' (set once, at send time)
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```
Delivery lifecycle (delivered/bounced/complained/delayed) is **not** stored here — it is logged only (see webhook). This table is the audit ledger of what we attempted to send, and is the **first thing trimmed under storage pressure**.

### Migrations
- `0012` — `npm run db:generate` after adding `users.email_alerts`, `email_templates`, `sent_emails`.
- `0013` (`drizzle-kit generate --custom`) — **seed the 4 default templates** (Hebrew, RTL) with `--> statement-breakpoint` between inserts:
  - `_layout`: wrapper HTML + inline style; placeholders `{{subject}}`, `{{content}}`, `dir="rtl"`.
  - `invite`: subject `הוזמנת למעקב הפרלמנטרי`; body uses `{{siteUrl}}`, `{{roleLine}}`.
  - `bill_digest`: subject `עדכון בהצעות חוק שאתה עוקב אחריהן ({{count}})`; body greets `{{name}}` and contains `{{bills}}` (raw, pre-rendered list).
  - `bill_digest_item`: a single row template with `{{title}}`, `{{oldStatus}}`, `{{newStatus}}`, `{{knessetUrl}}`.

## Components

### 1. `server/repositories/email-templates-repository.ts` (new)
Follows `FeatureFlagsRepository`. In-memory cache with TTL (e.g. 5 min), reset on update.
- `getAll(): Promise<EmailTemplate[]>`
- `get(name: string): Promise<EmailTemplate | null>` (cached)
- `update(name, { subject, html }): Promise<void>` (upsert via `onConflictDoUpdate`, bumps `updatedAt`, clears cache)
- `_resetCache()` for tests.

### 2. `server/repositories/sent-emails-repository.ts` (new)
- `record({ id, toEmail, template, status, error }): Promise<void>` (insert; ignore conflict on `id`).
- `deleteOldest(limit: number): Promise<number>` — delete the `limit` oldest rows by `createdAt`, return count deleted (used by the storage-pressure reclaimer).
- `count(): Promise<number>` / `list(limit)` for tests/observability.
- No `updateStatus` — the webhook never writes to the DB.

### 3. `server/services/email-render.ts` (new)
Generalized, storage-agnostic render layer (callers never see HTML or the DB).
- `renderTemplate(name: string, params: Record<string, string>, opts?: { raw?: string[] }): Promise<{ subject: string; html: string }>`
  - Fetch the `name` row + the `_layout` row from `EmailTemplatesRepository`.
  - Substitute `{{key}}` in both subject and body with `params[key]`; **HTML-escape** values except keys listed in `opts.raw` (used for `bills`).
  - Wrap the rendered body in `_layout` (`{{content}}` = body, `{{subject}}` = subject).
  - Missing key → empty string; missing template row → throw (surfaced as a logged send failure, not to the trigger).

### 4. `server/services/email.ts` (new)
The send primitive. Lazy client, mirroring `getGoogleClient()`.
- `getResend(): Resend | null` — `null` when `RESEND_API_KEY` unset.
- `sendEmail({ to, template, params, raw }): Promise<void>`
  - `renderTemplate(template, params, { raw })` → `{ subject, html }`.
  - If `getResend()` is `null`: `console.warn` and **return** (dev/test no-op; nothing recorded).
  - Else `resend.emails.send({ from: EMAIL_FROM, to, subject, html })`.
    - On success: `sentEmailsRepo.record({ id: data.id, toEmail: to, template, status: 'sent' })` and `console.info('[email] sent template=%s to=%s msgId=%s', template, redactEmail(to), data.id)`.
    - On error/throw: `console.error('[email] send failed template=%s to=%s', template, redactEmail(to), err)`; record with a synthetic id (`failed:${uuid}`), `status: 'failed'`, `error`. **Never throw.**
- `sendEmailsThrottled(messages: SendArgs[]): Promise<void>` — sends sequentially with ≥500 ms spacing (≤2 req/s) for digest bursts.

### 4a. `server/services/email-redaction.ts` (new, tiny)
- `redactEmail(email: string): string` — `'avivavitan63@gmail.com'` → `'avivavitan63@…'` (keep local part, drop domain). No `@` → returns `'…'`. Used by every email log line (send + webhook) so no full address ever reaches the logs.

### 5. Invitation wiring — `server/routes/admin.ts`
After `await authRepo.addInvite(...)`:
```ts
void sendEmail({
  to: email.trim().toLowerCase(),
  template: 'invite',
  params: { siteUrl: process.env.PUBLIC_SITE_URL ?? '', roleLine: grantRole === 'admin' ? '... (מנהל)' : '' },
}).catch((e) => console.error('[email] invite send failed:', e))
```
Response unaffected.

### 6. Alerts — preference plumbing
- `users.email_alerts` (above). `UsersRepository.setEmailAlerts(userId, value)`.
- `emailAlerts` added to the user object from `GET /api/auth/me`, `POST /api/auth/google`, `POST /api/auth/refresh`; add to `User` in `src/types.ts`.
- New `PATCH /api/auth/me` (`requireAuth`), body `{ emailAlerts: boolean }` → `setEmailAlerts` → returns updated user. Non-boolean body → `400`.

### 7. Alerts — poller (`server/services/poller.ts`)
- During the bill loop, on `changed` push `{ billId: bill.id, title: bill.title, oldStatus: bill.status ?? null, newStatus, knessetUrl: bill.knessetUrl ?? '' }` to a `changes` array.
- After the loop, if `changes.length`:
  - `recipients = await trackedBillsRepo.findAlertRecipients(changes.map(c => c.billId))`.
  - Group recipients by `userId`; for each user build the digest: render each of their bills via `bill_digest_item`, join into `billsHtml`, then queue `sendEmail({ to, template: 'bill_digest', params: { name, count, bills: billsHtml }, raw: ['bills'] })`.
  - `await sendEmailsThrottled(queued)` — fire-and-forget relative to poll result (wrap in try/catch; does not flip `anySuccess`).

### 8. Alerts — recipient query (`server/repositories/tracked-bills-repository.ts`)
```ts
findAlertRecipients(billIds: number[]): Promise<Array<{ userId: number; email: string; name: string | null; billId: number }>>
```
Join `tracked_bills` → `users` where `bill_id IN (billIds)` AND `users.role <> 'group'` AND `users.email IS NOT NULL` AND `users.email_alerts = true`. `[]` for empty input.

### 9. Delivery webhook — `server/routes/webhooks.ts` (new) — **log only, stores nothing**
- `POST /api/webhooks/resend`, **public** (no `requireAuth`, excluded from CORS gating), mounted with `express.raw({ type: 'application/json' })` so the raw body is available for signature verification.
- Verify with `svix`: `new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(rawBody, { 'svix-id', 'svix-timestamp', 'svix-signature' })`. Invalid → `400`.
- On a verified event, **log a single structured line and return `200`** — no DB read or write:
  ```
  console.info('[email] delivery event=%s to=%s msgId=%s',
    type.replace('email.', ''), redactEmail(data.to?.[0] ?? ''), data.email_id)
  ```
  e.g. `[email] delivery event=bounced to=avivavitan63@… msgId=re_abc123`.
- The Resend message id is the lookup key for full detail (subject, full address, bounce reason) in the Resend dashboard. No `sent_emails` update; the webhook touches no repository.

### 10. Admin template editor
- Routes (`server/routes/admin.ts`, `requireAdmin`): `GET /api/admin/email-templates` (list), `PUT /api/admin/email-templates/:name` (`{ subject, html }`).
- UI in `src/components/admin/AdminPanel.tsx`: an "Email templates" section listing templates with editable subject/HTML textareas and a Save button → `api.admin.emailTemplates.list()` / `.update(name, body)`; success/error toast.

### 11. Client (`src/lib/api-client.ts`)
- `api.auth.updateMe({ emailAlerts })` → `PATCH /auth/me`.
- `api.admin.emailTemplates.list()` / `.update(name, { subject, html })`.

### 12. Toggle UI (`src/components/layout/AuthControl.tsx`)
Signed-in: checkbox "התראות במייל" bound to `user.emailAlerts` → `api.auth.updateMe` → update context user + toast.

### 13. Type cleanup
Widen `Bill.status` (`src/types.ts:16`) from the 4-value union to `string` (the poller already writes the full Knesset vocabulary). Adjust any exhaustiveness assumptions.

### 14. Config / env (`.env.example`) — all **server-side only**
- `RESEND_API_KEY` — Resend API key (Render env).
- `EMAIL_FROM` — verified sender, e.g. `Liberal <noreply@yourdomain>`.
- `PUBLIC_SITE_URL` — invite link target, e.g. `https://derlegatlabienus.github.io`.
- `RESEND_WEBHOOK_SECRET` — Svix signing secret from the Resend webhook config.

### 15. Storage-pressure generalization — `server/services/storage-manager.ts`
The current `purgeOrphansIfNeeded` is orphan-entity-specific. Generalize it into a **reclaimer pipeline** so the `sent_emails` ledger (and future growing tables) participate in pressure relief.

```ts
interface Reclaimer { name: string; reclaim(): Promise<number> } // rows freed this pass
```

- Rename the entry point to `relieveStoragePressureIfNeeded(usedBytes)`, keeping the same `(usedBytes) => Promise<PurgeResult>` contract. Update the one poller call (`server/services/poller.ts:159`) and the test imports/`describe` in `tests/server/storage-manager.test.ts` (mechanical rename).
- Pressure check unchanged (reuses the `storagePressure` flag, `limitMb:slackMb`, `-1` disables). When over budget:
  ```ts
  for (const r of reclaimers) {
    const freed = await r.reclaim()
    if (freed > 0) used = await usedBytes()      // re-measure only after a change
    if (used !== null && used <= target) break   // back under budget → stop
  }
  ```
- Reclaimers, **cheapest / least-valuable first**:
  1. `sentEmailsReclaimer` — `sentEmailsRepo.deleteOldest(SENT_EMAIL_PURGE_BATCH)` (default 500, env-overridable like `ORPHAN_PURGE_BATCH`). Writes count into `result.sentEmailsDeleted`.
  2. `orphanEntitiesReclaimer` — the existing orphan logic extracted verbatim (stalest-first untracked bills/committees/MKs + children + summaries, batch 5).
- `PurgeResult` gains `sentEmailsDeleted: number` (existing fields untouched → current storage-manager tests stay green). Per-cycle cadence preserved: one batch per reclaimer per cycle, recovering gradually across cycles.

## Dedup
The poller fires only when `newStatus !== bill.status` and writes `newStatus` the same cycle → each change emails once. No "already notified" table.

## Error handling
- Missing `RESEND_API_KEY`: `sendEmail` no-ops; nothing recorded; code paths work.
- Resend send rejection: logged (redacted) + recorded as `failed`; never propagates to invite response or poll result.
- Webhook bad signature → `400`; verified event always → `200` after logging (no DB lookup, so an unknown id is irrelevant).
- `PATCH /api/auth/me` non-boolean → `400`.
- Missing template row at render → logged send failure (not surfaced to trigger).

## Testing
- **`email-render.ts`**: `{{placeholder}}` substitution; HTML-escapes non-raw params; injects raw `bills`; wraps in `_layout`; missing key → empty.
- **`email.ts`** (mock `resend` + repos): key unset → no client call, no record, resolves; key set → calls `emails.send` and records `sent` with returned id; send rejects → records `failed`, resolves; `sendEmailsThrottled` preserves order and spacing.
- **`redactEmail`**: `a@b.com` → `a@…`; no `@` → `…`; empty → `…`.
- **Invite route**: adding an invite calls `sendEmail`; route returns `{ ok: true }` even when `sendEmail` rejects.
- **Poller digest**: two users tracking overlapping bills, one with `emailAlerts=false`; simulate changes; exactly one digest per eligible user with correct bills grouped; opted-out and group users get none.
- **`findAlertRecipients`**: only personal trackers with email + alerts on; excludes group role / null email / alerts off; `[]` for empty input.
- **Webhook**: valid signature + `email.delivered` → `200` and a log line containing the redacted recipient + msgId, and **no DB write** (spy on `SentEmailsRepository`); bad signature → `400`.
- **`EmailTemplatesRepository`**: get/update round-trip; cache reset on update.
- **`SentEmailsRepository`**: record + `deleteOldest` (deletes by oldest `createdAt`, returns count); `count`.
- **Storage-pressure reclaimer**: over budget → `sentEmailsReclaimer` trims oldest batch first, `relieveStoragePressureIfNeeded` reports `sentEmailsDeleted`; re-measures and stops before purging orphan entities if back under budget; existing orphan-purge tests still pass.
- **Admin templates routes**: list + update under `requireAdmin`; non-admin → `403`.
- **Preference route + UI**: `PATCH /api/auth/me` updates the flag; `AuthControl` toggle calls `api.auth.updateMe`.

## Operational notes (manual, one-time)
- Verify the sending domain in Resend (SPF/DKIM/DMARC) and set `EMAIL_FROM` to it. Until verified, Resend's sandbox only delivers to the account owner's address — code paths still function.
- Create a Resend webhook pointing at `https://<api-host>/api/webhooks/resend`, subscribe to the email lifecycle events, and put its signing secret in `RESEND_WEBHOOK_SECRET`.

## Out of scope (YAGNI)
- Committee/MK change alerts (bills only).
- Per-recipient unsubscribe links (the in-app toggle covers opt-out for a closed group).
- Template versioning/history and live preview in the admin editor.
- Retry/queue for failed sends (recorded as `failed`; resend is manual for now).
