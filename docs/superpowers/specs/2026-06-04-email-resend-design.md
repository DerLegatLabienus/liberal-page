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
- **Delivery semantics:** fire-and-forget toward the trigger; send result + lifecycle status **persisted** in `sent_emails`.
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
                                ▼ record
                        sent_emails (id, to, template, status, error)
                                ▲ update
 Resend webhook ──▶ POST /api/webhooks/resend (svix-verified) ─┘
   (delivered / bounced / complained / delivery_delayed)
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

### `sent_emails`
```ts
export const sentEmails = pgTable('sent_emails', {
  id: text('id').primaryKey(),              // Resend message id
  toEmail: text('to_email').notNull(),
  template: text('template').notNull(),
  subject: text('subject').notNull().default(''),
  status: text('status').notNull().default('sent'), // sent|delivered|bounced|complained|delivery_delayed|failed
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
```

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
- `record({ id, toEmail, template, subject, status, error }): Promise<void>` (upsert on `id`).
- `updateStatus(id, status, error?): Promise<void>` (no-op if `id` unknown).
- `get(id)` / `list(limit)` for tests/observability.

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
    - On success: `sentEmailsRepo.record({ id: data.id, toEmail: to, template, subject, status: 'sent' })`.
    - On error/throw: `console.error`; record with a synthetic id (`failed:${uuid}`) and `status: 'failed'`, `error`. **Never throw.**
- `sendEmailsThrottled(messages: SendArgs[]): Promise<void>` — sends sequentially with ≥500 ms spacing (≤2 req/s) for digest bursts.

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

### 9. Delivery webhook — `server/routes/webhooks.ts` (new)
- `POST /api/webhooks/resend`, **public** (no `requireAuth`, excluded from CORS gating), mounted with `express.raw({ type: 'application/json' })` so the raw body is available for signature verification.
- Verify with `svix`: `new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(rawBody, { 'svix-id', 'svix-timestamp', 'svix-signature' })`. Invalid → `400`.
- Map event `type` → status: `email.sent`→`sent`, `email.delivered`→`delivered`, `email.bounced`→`bounced`, `email.complained`→`complained`, `email.delivery_delayed`→`delivery_delayed`. Call `sentEmailsRepo.updateStatus(data.email_id, status, errorIfAny)`. Unknown id → no-op. Always `200` on a verified event.

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

## Dedup
The poller fires only when `newStatus !== bill.status` and writes `newStatus` the same cycle → each change emails once. No "already notified" table.

## Error handling
- Missing `RESEND_API_KEY`: `sendEmail` no-ops; nothing recorded; code paths work.
- Resend send rejection: logged + recorded as `failed`; never propagates to invite response or poll result.
- Webhook bad signature → `400`; unknown email id → `200` no-op.
- `PATCH /api/auth/me` non-boolean → `400`.
- Missing template row at render → logged send failure (not surfaced to trigger).

## Testing
- **`email-render.ts`**: `{{placeholder}}` substitution; HTML-escapes non-raw params; injects raw `bills`; wraps in `_layout`; missing key → empty.
- **`email.ts`** (mock `resend` + repos): key unset → no client call, no record, resolves; key set → calls `emails.send` and records `sent` with returned id; send rejects → records `failed`, resolves; `sendEmailsThrottled` preserves order and spacing.
- **Invite route**: adding an invite calls `sendEmail`; route returns `{ ok: true }` even when `sendEmail` rejects.
- **Poller digest**: two users tracking overlapping bills, one with `emailAlerts=false`; simulate changes; exactly one digest per eligible user with correct bills grouped; opted-out and group users get none.
- **`findAlertRecipients`**: only personal trackers with email + alerts on; excludes group role / null email / alerts off; `[]` for empty input.
- **Webhook**: valid signature + `email.delivered` updates row to `delivered`; bad signature → `400`; unknown id → `200` no-op.
- **`EmailTemplatesRepository`**: get/update round-trip; cache reset on update.
- **`SentEmailsRepository`**: record + updateStatus; updateStatus on unknown id is a no-op.
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
