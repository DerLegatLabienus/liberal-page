# Email via Resend — Invitation Emails + Bill-Status Alerts

**Date:** 2026-06-04
**Status:** Approved design
**Backlog:** #3 (multi-user accounts) — alerts half (#3b)

## Goal

Add a transactional email capability over a single shared sender (Resend) serving two use cases:

1. **Invitation emails** — sent when an admin adds an email to the allowlist.
2. **Bill-status alert digests** — sent to members when a bill they personally track changes status.

Email is a best-effort side channel: a send failure must never break the API call or poll cycle that triggered it.

## Decisions (locked)

- **Provider:** Resend.
- **Alert recipients:** personal trackers only (users who track the bill on their own list). Group-list-only bills do not generate alerts (the group account has no email).
- **Opt-out:** per-user toggle `users.email_alerts`, **default on**.
- **Batching:** **one digest email per member per poll cycle**, grouping all of that member's changed bills — not one email per bill.
- **Delivery semantics:** fire-and-forget. Never throw to the triggering caller.
- **Invite re-sends:** the invite email fires on **every** `POST /api/admin/invites`, including re-inviting an already-listed address. (Simple; admins control invite volume.)
- **Toggle placement:** inside the signed-in `AuthControl` area (no dedicated settings page).

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐
│ admin.ts POST/invites│────▶│                          │
└─────────────────────┘     │  email.ts                │     ┌──────────┐
                            │  sendEmail({to,subject,  │────▶│  Resend  │
┌─────────────────────┐     │           html})         │     │   API    │
│ poller.ts pollBills  │────▶│  (lazy client; no-op if  │     └──────────┘
│ (digest per user)    │     │   RESEND_API_KEY unset)  │
└─────────────────────┘     └──────────────────────────┘
                                       ▲
                            ┌──────────┴───────────┐
                            │ email-templates.ts    │
                            │ inviteEmail()         │
                            │ billDigestEmail()     │
                            └──────────────────────┘
```

## Components

### 1. `server/services/email.ts` (new)

The single send primitive. Mirrors the lazy `getGoogleClient()` pattern in `auth-service.ts` so an unset key never crashes boot.

- `getResend(): Resend | null` — lazily constructs `new Resend(process.env.RESEND_API_KEY)`; returns `null` when the key is unset.
- `sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void>`
  - If `getResend()` is `null`: `console.warn('[email] RESEND_API_KEY unset — skipping send to <to>')` and return. **No throw.**
  - Otherwise call `resend.emails.send({ from: process.env.EMAIL_FROM!, to, subject, html })`. On a rejected promise, `console.error` and swallow (caller already treats this as fire-and-forget, but the primitive is defensive too).

### 2. `server/services/email-templates.ts` (new)

Pure functions returning `{ subject: string; html: string }`. Hebrew, RTL (`<div dir="rtl">`).

- `inviteEmail({ siteUrl, role }: { siteUrl: string; role: 'admin' | 'member' }): { subject, html }`
  - Subject: e.g. `הוזמנת למעקב הפרלמנטרי`.
  - Body: explains they've been invited, to sign in with Google **using this email address**, with a button/link to `siteUrl`. Mentions admin role if `role === 'admin'`.
- `billDigestEmail({ name, bills }: { name: string | null; bills: BillChange[] }): { subject, html }`
  - `BillChange = { title: string; oldStatus: string | null; newStatus: string; knessetUrl: string }`
  - Subject: e.g. `עדכון בהצעות חוק שאתה עוקב אחריהן (${bills.length})`.
  - Body: greeting (by `name` if present), then a list — each item: bill title (linked to `knessetUrl`), `oldStatus → newStatus`.

### 3. Invitation email wiring — `server/routes/admin.ts`

In the existing `POST /invites` handler, after `await authRepo.addInvite(...)` and before `res.json({ ok: true })`:

```ts
const siteUrl = process.env.PUBLIC_SITE_URL ?? ''
void sendEmail({ to: email.trim().toLowerCase(), ...inviteEmail({ siteUrl, role: grantRole }) })
  .catch((e) => console.error('[email] invite send failed:', e))
```

The response is unaffected by email outcome.

### 4. Alerts: schema + preference

- **Migration `0012`** (`npm run db:generate` after schema edit): add to `users`:
  ```ts
  emailAlerts: boolean('email_alerts').notNull().default(true),
  ```
  (Requires importing `boolean` from `drizzle-orm/pg-core` in `server/db/schema/tracking.ts`.)
- **User payload:** `emailAlerts` is included in the user object returned by `GET /api/auth/me`, `POST /api/auth/google`, and `POST /api/auth/refresh`. Update the user-serialization in `auth-service.ts` / the auth routes and the `User` type in `src/types.ts`.
- **New route:** `PATCH /api/auth/me` (under `requireAuth`) with body `{ emailAlerts: boolean }` → `UsersRepository.setEmailAlerts(userId, emailAlerts)` → returns the updated user. New repo method `setEmailAlerts(userId: number, value: boolean): Promise<void>`.

### 5. Alerts: poller — `server/services/poller.ts`

In `pollBills`:

- Accumulate changes in an array during the loop. On `changed`, push
  `{ billId: bill.id, title: bill.title, oldStatus: bill.status ?? null, newStatus, knessetUrl: bill.knessetUrl }`.
  (`bill.id` is the internal DB id; `knessetUrl` is already on the `Bill` aggregate — confirm field name during implementation and fall back to constructing it if absent.)
- After the loop, if any changes:
  ```ts
  const recipients = await trackedBillsRepo.findAlertRecipients(changes.map(c => c.billId))
  // group recipients by user, attach their changed bills, send one digest each
  ```
- `void sendEmail(...).catch(log)` per user — fire-and-forget, does not affect the poll result.

### 6. Alerts: recipient query — `server/repositories/tracked-bills-repository.ts`

New method:

```ts
findAlertRecipients(billIds: number[]): Promise<Array<{ userId: number; email: string; name: string | null; billId: number }>>
```

SQL: join `tracked_bills` → `users`, where `tracked_bills.bill_id IN (billIds)` AND `users.role <> 'group'` AND `users.email IS NOT NULL` AND `users.email_alerts = true`. Returns one row per (user, bill); the poller groups by user.

Returns `[]` for an empty `billIds` array (no query).

### 7. Toggle UI — `src/components/layout/AuthControl.tsx`

When signed in, render a small checkbox: "התראות במייל" bound to `user.emailAlerts`. On change → `api.auth.updateMe({ emailAlerts })` (new client method calling `PATCH /api/auth/me`) → update auth context user + success/error toast. Uses existing `useToastOptional`.

### 8. Config / env — `.env.example`

Document (all **server-side only**, never frontend/git):
- `RESEND_API_KEY` — Resend API key (set in Render env).
- `EMAIL_FROM` — verified sender, e.g. `Liberal <noreply@yourdomain>`.
- `PUBLIC_SITE_URL` — link target for invite emails, e.g. `https://derlegatlabienus.github.io`.

## Dedup

The poller fires alerts only when `newStatus !== bill.status` and writes `newStatus` to the bill row the same cycle. A given status change therefore emails exactly once; no "already notified" table is needed.

## Error handling

- Missing `RESEND_API_KEY`: `sendEmail` no-ops (dev/test never send). Code paths work regardless.
- Resend API rejection: logged, swallowed; never propagates to the invite response or poll result.
- `PATCH /api/auth/me` with a non-boolean body → `400`.

## Testing

- **`email.ts`** (`tests/server/email.test.ts`): mock the `resend` module. (a) key unset → `sendEmail` does not construct a client / does not call `send`, resolves without throwing; (b) key set → calls `resend.emails.send` with `from`/`to`/`subject`/`html`; (c) `send` rejects → `sendEmail` still resolves.
- **Invite route** (`tests/server/admin-invite-email.test.ts`): adding an invite calls `sendEmail`; route returns `{ ok: true }` even when `sendEmail` rejects.
- **Poller digest** (`tests/server/poller-alerts.test.ts`): seed two users tracking overlapping bills, one with `emailAlerts=false`; simulate status changes; assert exactly one digest per eligible user, with the correct bills grouped, and the opted-out user receives none; the group user receives none.
- **`findAlertRecipients`** (in a repository test): returns only personal trackers with email + alerts on; excludes group role, null email, alerts off; `[]` for empty input.
- **Preference route + UI**: `PATCH /api/auth/me` updates the flag; `AuthControl` toggle calls `api.auth.updateMe` and reflects the new value.

## Operational note (manual, one-time)

Domain verification (SPF/DKIM/DMARC in the Resend dashboard + setting `EMAIL_FROM` to that verified domain) is done by the operator, not in code. Until verified, Resend's sandbox only delivers to the account owner's own address — all code paths still function.

## Out of scope (YAGNI)

- Committee/MK change alerts (bills only for now).
- Digest scheduling / batching beyond per-poll-cycle.
- HTML email theming framework — inline-styled RTL HTML is sufficient.
- Unsubscribe links (the in-app toggle covers opt-out for a closed group).
