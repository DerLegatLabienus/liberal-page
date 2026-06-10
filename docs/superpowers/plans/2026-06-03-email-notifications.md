# Email via Resend — Invitations + Bill-Status Alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transactional email capability (Resend) that sends invitation emails when an admin adds an allowlist entry, and per-member bill-status alert digests once per poll cycle, with DB-stored editable templates and persisted per-email delivery status.

**Architecture:** A small layered email subsystem: `email-render.ts` (DB templates → HTML) under `email.ts` (the lazy Resend send primitive, fire-and-forget, records to `sent_emails`), wired into the existing admin invite route and the bill poller. Delivery lifecycle flows back via a signature-verified Resend webhook. All email is best-effort — a send failure never breaks the triggering API call or poll cycle.

**Tech Stack:** Express 5, Drizzle ORM + node-postgres (pglite in tests), `resend` SDK, `svix` (webhook signature verification), React 18 + Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-email-resend-design.md` (Approved).

---

## File Structure

**New files:**
- `server/db/schema/email.ts` — `email_templates`, `sent_emails` tables
- `server/repositories/email-templates-repository.ts` — cached template CRUD
- `server/repositories/sent-emails-repository.ts` — delivery-status records
- `server/services/email-render.ts` — `renderTemplate(name, params, opts)`
- `server/services/email.ts` — `getResend`, `sendEmail`, `sendEmailsThrottled`
- `server/routes/webhooks.ts` — `POST /api/webhooks/resend`
- `server/db/migrations/0012_*.sql` — generated (schema)
- `server/db/migrations/0013_seed_email_templates.sql` — custom (4 default templates)
- Test files under `tests/server/` mirroring each unit

**Modified files:**
- `server/db/schema/tracking.ts` — add `users.email_alerts`
- `server/db/schema/index.ts` — export `./email`
- `server/repositories/users-repository.ts` — `setEmailAlerts`
- `server/repositories/tracked-bills-repository.ts` — `findAlertRecipients`
- `server/services/poller.ts` — collect bill changes, queue digests
- `server/routes/admin.ts` — invite email; template editor routes
- `server/routes/auth.ts` — `PATCH /me`; include `emailAlerts` in user payloads
- `server/index.ts` — mount webhook router (before `express.json()`)
- `src/lib/api-client.ts` — `auth.updateMe`, `admin.emailTemplates`
- `src/components/layout/AuthControl.tsx` — email-alerts toggle
- `src/components/admin/AdminPanel.tsx` — email-templates editor section
- `src/types.ts` — `User.emailAlerts`; widen `Bill.status` to `string`
- `.env.example` — `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_SITE_URL`, `RESEND_WEBHOOK_SECRET`
- `CLAUDE.md` / `docs/architecture.md` / `docs/data-schema.md` — doc updates

---

## Task 1: Schema — `email_templates`, `sent_emails`, `users.email_alerts`

**Files:**
- Create: `server/db/schema/email.ts`
- Modify: `server/db/schema/tracking.ts` (users table), `server/db/schema/index.ts`
- Generate: `server/db/migrations/0012_*.sql`

- [ ] **Step 1: Create the email schema file**

`server/db/schema/email.ts`:
```ts
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

// Editable email templates, keyed by name. '_layout' is the shared wrapper.
export const emailTemplates = pgTable('email_templates', {
  name: text('name').primaryKey(),          // 'invite' | 'bill_digest' | 'bill_digest_item' | '_layout'
  subject: text('subject').notNull().default(''),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// One row per attempted send; status updated by the Resend webhook.
export const sentEmails = pgTable('sent_emails', {
  id: text('id').primaryKey(),              // Resend message id, or `failed:<uuid>`
  toEmail: text('to_email').notNull(),
  template: text('template').notNull(),
  subject: text('subject').notNull().default(''),
  status: text('status').notNull().default('sent'), // sent|delivered|bounced|complained|delivery_delayed|failed
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
```

- [ ] **Step 2: Add `email_alerts` to the users table**

In `server/db/schema/tracking.ts`, add `boolean` to the import and the column to `users`:
```ts
import { pgTable, serial, integer, text, timestamp, unique, boolean } from 'drizzle-orm/pg-core'
```
Add as the last column of `users` (after `lastLoginAt`):
```ts
  emailAlerts: boolean('email_alerts').notNull().default(true),
```

- [ ] **Step 3: Export the new schema**

In `server/db/schema/index.ts` add:
```ts
export * from './email'
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `server/db/migrations/0012_*.sql` creating `email_templates`, `sent_emails`, and `ALTER TABLE users ADD COLUMN email_alerts`. Inspect it to confirm all three changes are present.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/email.ts server/db/schema/tracking.ts server/db/schema/index.ts server/db/migrations/0012_*.sql
git commit -m "feat(email): schema for email_templates, sent_emails, users.email_alerts"
```

---

## Task 2: Seed default templates (custom migration 0013)

**Files:**
- Create: `server/db/migrations/0013_seed_email_templates.sql`

- [ ] **Step 1: Generate a custom (empty) migration**

Run: `npx drizzle-kit generate --custom --name=seed_email_templates`
Expected: an empty `0013_seed_email_templates.sql`.

- [ ] **Step 2: Fill it with the four Hebrew/RTL default templates**

Replace the file contents with (use `--> statement-breakpoint` between inserts; `ON CONFLICT (name) DO NOTHING` so re-runs are safe):
```sql
INSERT INTO email_templates (name, subject, html) VALUES (
  '_layout', '',
  '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;background:#f6f6f6;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;color:#222"><h2 style="margin:0 0 16px">{{subject}}</h2>{{content}}<hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#999">התא הליברלי</p></div></div>'
) ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO email_templates (name, subject, html) VALUES (
  'invite', 'הוזמנת למעקב הפרלמנטרי',
  '<p>הוזמנת להצטרף למעקב הפרלמנטרי של התא הליברלי{{roleLine}}.</p><p><a href="{{siteUrl}}">היכנס/י כאן</a> והתחבר/י באמצעות חשבון Google שלך.</p>'
) ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO email_templates (name, subject, html) VALUES (
  'bill_digest', 'עדכון בהצעות חוק שאתה עוקב אחריהן ({{count}})',
  '<p>שלום {{name}},</p><p>חל שינוי בסטטוס של הצעות החוק הבאות שאתה עוקב אחריהן:</p>{{bills}}'
) ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO email_templates (name, subject, html) VALUES (
  'bill_digest_item', '',
  '<div style="margin:0 0 12px;padding:12px;border:1px solid #eee;border-radius:6px"><a href="{{knessetUrl}}" style="font-weight:bold">{{title}}</a><div style="font-size:13px;color:#555">{{oldStatus}} ← {{newStatus}}</div></div>'
) ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 3: Verify migration applies in tests**

Run: `npx vitest run tests/server/feature-flags-repository.test.ts`
Expected: PASS — confirms the migration set (including 0012/0013) still boots cleanly under pglite via `setupTestDb`.

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/0013_seed_email_templates.sql
git commit -m "feat(email): seed default Hebrew RTL email templates (migration 0013)"
```

---

## Task 3: EmailTemplatesRepository

**Files:**
- Create: `server/repositories/email-templates-repository.ts`
- Test: `tests/server/email-templates-repository.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/email-templates-repository.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { emailTemplates } from '../../server/db/schema'
import { EmailTemplatesRepository } from '../../server/repositories/email-templates-repository'

describe('EmailTemplatesRepository', () => {
  const repo = new EmailTemplatesRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(emailTemplates); repo._resetCache() })

  it('get() returns null for unknown template', async () => {
    expect(await repo.get('nope')).toBeNull()
  })

  it('update() upserts and get() round-trips', async () => {
    await repo.update('invite', { subject: 'S', html: '<p>hi</p>' })
    const t = await repo.get('invite')
    expect(t).toMatchObject({ name: 'invite', subject: 'S', html: '<p>hi</p>' })
  })

  it('update() overwrites and clears cache', async () => {
    await repo.update('invite', { subject: 'A', html: '<p>a</p>' })
    await repo.get('invite') // populate cache
    await repo.update('invite', { subject: 'B', html: '<p>b</p>' })
    expect((await repo.get('invite'))?.subject).toBe('B')
  })

  it('getAll() lists all templates', async () => {
    await repo.update('invite', { subject: 'S', html: 'x' })
    await repo.update('_layout', { subject: '', html: 'y' })
    const all = await repo.getAll()
    expect(all.map((t) => t.name).sort()).toEqual(['_layout', 'invite'])
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/email-templates-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

`server/repositories/email-templates-repository.ts`:
```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { emailTemplates } from '../db/schema'

export interface EmailTemplate { name: string; subject: string; html: string; updatedAt: Date }

const TTL_MS = 5 * 60 * 1000

export class EmailTemplatesRepository {
  private cache = new Map<string, { value: EmailTemplate | null; at: number }>()

  _resetCache(): void { this.cache.clear() }

  async getAll(): Promise<EmailTemplate[]> {
    return db.select().from(emailTemplates)
  }

  async get(name: string): Promise<EmailTemplate | null> {
    const hit = this.cache.get(name)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value
    const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.name, name))
    const value = row ?? null
    this.cache.set(name, { value, at: Date.now() })
    return value
  }

  async update(name: string, fields: { subject: string; html: string }): Promise<void> {
    const now = new Date()
    await db
      .insert(emailTemplates)
      .values({ name, subject: fields.subject, html: fields.html, updatedAt: now })
      .onConflictDoUpdate({ target: emailTemplates.name, set: { subject: fields.subject, html: fields.html, updatedAt: now } })
    this.cache.delete(name)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/email-templates-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/email-templates-repository.ts tests/server/email-templates-repository.test.ts
git commit -m "feat(email): EmailTemplatesRepository with TTL cache"
```

---

## Task 4: SentEmailsRepository

**Files:**
- Create: `server/repositories/sent-emails-repository.ts`
- Test: `tests/server/sent-emails-repository.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/sent-emails-repository.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { sentEmails } from '../../server/db/schema'
import { SentEmailsRepository } from '../../server/repositories/sent-emails-repository'

describe('SentEmailsRepository', () => {
  const repo = new SentEmailsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(sentEmails) })

  it('record() + get() round-trips', async () => {
    await repo.record({ id: 'm1', toEmail: 'a@b.c', template: 'invite', subject: 'S', status: 'sent' })
    expect(await repo.get('m1')).toMatchObject({ id: 'm1', status: 'sent', toEmail: 'a@b.c' })
  })

  it('updateStatus() updates an existing row', async () => {
    await repo.record({ id: 'm1', toEmail: 'a@b.c', template: 'invite', subject: 'S', status: 'sent' })
    await repo.updateStatus('m1', 'delivered')
    expect((await repo.get('m1'))?.status).toBe('delivered')
  })

  it('updateStatus() on unknown id is a no-op (does not throw)', async () => {
    await expect(repo.updateStatus('ghost', 'bounced')).resolves.toBeUndefined()
    expect(await repo.get('ghost')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/sent-emails-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

`server/repositories/sent-emails-repository.ts`:
```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { sentEmails } from '../db/schema'

export interface SentEmailRow {
  id: string; toEmail: string; template: string; subject: string
  status: string; error: string | null; createdAt: Date; updatedAt: Date
}

export class SentEmailsRepository {
  async record(input: { id: string; toEmail: string; template: string; subject: string; status: string; error?: string | null }): Promise<void> {
    const now = new Date()
    await db
      .insert(sentEmails)
      .values({ ...input, error: input.error ?? null, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: sentEmails.id, set: { status: input.status, error: input.error ?? null, updatedAt: now } })
  }

  async updateStatus(id: string, status: string, error?: string | null): Promise<void> {
    await db
      .update(sentEmails)
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where(eq(sentEmails.id, id))
  }

  async get(id: string): Promise<SentEmailRow | null> {
    const [row] = await db.select().from(sentEmails).where(eq(sentEmails.id, id))
    return (row as SentEmailRow) ?? null
  }

  async list(limit = 50): Promise<SentEmailRow[]> {
    return db.select().from(sentEmails).limit(limit) as Promise<SentEmailRow[]>
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/sent-emails-repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/sent-emails-repository.ts tests/server/sent-emails-repository.test.ts
git commit -m "feat(email): SentEmailsRepository (record + updateStatus)"
```

---

## Task 5: email-render.ts — `renderTemplate`

**Files:**
- Create: `server/services/email-render.ts`
- Test: `tests/server/email-render.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/email-render.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { emailTemplates } from '../../server/db/schema'
import { EmailTemplatesRepository } from '../../server/repositories/email-templates-repository'
import { renderTemplate } from '../../server/services/email-render'

const repo = new EmailTemplatesRepository()

async function seed(name: string, subject: string, html: string) {
  await repo.update(name, { subject, html })
}

describe('renderTemplate', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(emailTemplates); repo._resetCache()
    await seed('_layout', '', '<x>{{subject}}|{{content}}</x>') })

  it('substitutes params and wraps in _layout', async () => {
    await seed('invite', 'Hi {{name}}', '<p>{{name}}</p>')
    const out = await renderTemplate('invite', { name: 'Dan' })
    expect(out.subject).toBe('Hi Dan')
    expect(out.html).toBe('<x>Hi Dan|<p>Dan</p></x>')
  })

  it('HTML-escapes non-raw params', async () => {
    await seed('invite', 'S', '<p>{{name}}</p>')
    const out = await renderTemplate('invite', { name: '<b>x</b>' })
    expect(out.html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('injects raw params verbatim', async () => {
    await seed('bill_digest', 'S', '<p>{{bills}}</p>')
    const out = await renderTemplate('bill_digest', { bills: '<li>a</li>' }, { raw: ['bills'] })
    expect(out.html).toContain('<li>a</li>')
  })

  it('missing key renders empty string', async () => {
    await seed('invite', 'S', '<p>{{missing}}</p>')
    const out = await renderTemplate('invite', {})
    expect(out.html).toContain('<p></p>')
  })

  it('missing template row throws', async () => {
    await expect(renderTemplate('ghost', {})).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/email-render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer**

`server/services/email-render.ts`:
```ts
import { EmailTemplatesRepository } from '../repositories/email-templates-repository'

const templates = new EmailTemplatesRepository()

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function substitute(text: string, params: Record<string, string>, raw: Set<string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = params[key]
    if (v === undefined) return ''
    return raw.has(key) ? v : escapeHtml(v)
  })
}

/**
 * Render a named template against `params`, wrapped in the `_layout` template.
 * Values are HTML-escaped unless the key is listed in `opts.raw`.
 * Throws if the named template or `_layout` row is missing.
 */
export async function renderTemplate(
  name: string,
  params: Record<string, string>,
  opts?: { raw?: string[] },
): Promise<{ subject: string; html: string }> {
  const raw = new Set(opts?.raw ?? [])
  const tpl = await templates.get(name)
  if (!tpl) throw new Error(`email template not found: ${name}`)
  const layout = await templates.get('_layout')
  if (!layout) throw new Error('email template not found: _layout')

  const subject = substitute(tpl.subject, params, raw)
  const body = substitute(tpl.html, params, raw)
  const html = substitute(layout.html, { ...params, subject, content: body }, new Set(['subject', 'content']))
  return { subject, html }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/email-render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/email-render.ts tests/server/email-render.test.ts
git commit -m "feat(email): renderTemplate — DB templates with escape + raw + layout"
```

---

## Task 6: email.ts — `getResend`, `sendEmail`, `sendEmailsThrottled`

**Files:**
- Create: `server/services/email.ts`
- Test: `tests/server/email.test.ts`
- Add dependency: `resend`

- [ ] **Step 1: Install the Resend SDK**

Run: `npm install resend`
Expected: `resend` added to `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

`tests/server/email.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// Mock the render layer and the SentEmails repo so this test is pure.
const sendMock = vi.fn()
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: sendMock } })) }))
vi.mock('../../server/services/email-render', () => ({
  renderTemplate: vi.fn(async () => ({ subject: 'S', html: '<p>H</p>' })),
}))
const recordMock = vi.fn()
vi.mock('../../server/repositories/sent-emails-repository', () => ({
  SentEmailsRepository: vi.fn(() => ({ record: recordMock, updateStatus: vi.fn() })),
}))

import { sendEmail, sendEmailsThrottled } from '../../server/services/email'

describe('sendEmail', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.RESEND_API_KEY })

  it('no-ops when RESEND_API_KEY is unset (no send, no record)', async () => {
    await sendEmail({ to: 'a@b.c', template: 'invite', params: {} })
    expect(sendMock).not.toHaveBeenCalled()
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('sends and records "sent" with the returned id when key is set', async () => {
    process.env.RESEND_API_KEY = 'k'; process.env.EMAIL_FROM = 'F'
    sendMock.mockResolvedValueOnce({ data: { id: 'msg_1' }, error: null })
    await sendEmail({ to: 'a@b.c', template: 'invite', params: {} })
    expect(sendMock).toHaveBeenCalledOnce()
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg_1', status: 'sent', toEmail: 'a@b.c' }))
  })

  it('records "failed" and resolves when send rejects', async () => {
    process.env.RESEND_API_KEY = 'k'
    sendMock.mockRejectedValueOnce(new Error('boom'))
    await expect(sendEmail({ to: 'a@b.c', template: 'invite', params: {} })).resolves.toBeUndefined()
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('sendEmailsThrottled preserves order', async () => {
    process.env.RESEND_API_KEY = 'k'
    const ids: string[] = []
    sendMock.mockImplementation(async () => { ids.push('x'); return { data: { id: `id${ids.length}` }, error: null } })
    await sendEmailsThrottled([
      { to: '1@b.c', template: 'bill_digest', params: {} },
      { to: '2@b.c', template: 'bill_digest', params: {} },
    ])
    expect(sendMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run it to verify failure**

Run: `npx vitest run tests/server/email.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the send primitive**

`server/services/email.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { Resend } from 'resend'
import { renderTemplate } from './email-render'
import { SentEmailsRepository } from '../repositories/sent-emails-repository'

const sentEmails = new SentEmailsRepository()

let client: Resend | null = null
export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!client) client = new Resend(key)
  return client
}

export interface SendArgs {
  to: string
  template: string
  params: Record<string, string>
  raw?: string[]
}

/** Render + send one email. Best-effort: never throws; records the outcome when a client exists. */
export async function sendEmail({ to, template, params, raw }: SendArgs): Promise<void> {
  const resend = getResend()
  let subject = ''
  try {
    const rendered = await renderTemplate(template, params, { raw })
    subject = rendered.subject
    if (!resend) { console.warn(`[email] RESEND_API_KEY unset — skipping ${template} to ${to}`); return }
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? 'noreply@example.com',
      to,
      subject: rendered.subject,
      html: rendered.html,
    })
    if (error || !data) {
      console.error(`[email] send error for ${template} to ${to}:`, error)
      await sentEmails.record({ id: `failed:${randomUUID()}`, toEmail: to, template, subject, status: 'failed', error: String(error?.message ?? error ?? 'unknown') })
      return
    }
    await sentEmails.record({ id: data.id, toEmail: to, template, subject, status: 'sent' })
  } catch (e) {
    console.error(`[email] send threw for ${template} to ${to}:`, e)
    if (resend) {
      await sentEmails.record({ id: `failed:${randomUUID()}`, toEmail: to, template, subject, status: 'failed', error: String((e as Error).message) })
        .catch(() => { /* swallow */ })
    }
  }
}

/** Send sequentially with ≥500ms spacing to stay within Resend's 2 req/s default. */
export async function sendEmailsThrottled(messages: SendArgs[]): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    await sendEmail(messages[i])
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, 500))
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/server/email.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add server/services/email.ts tests/server/email.test.ts package.json package-lock.json
git commit -m "feat(email): sendEmail + sendEmailsThrottled (lazy Resend, fire-and-forget)"
```

---

## Task 7: Invitation email wiring (`admin.ts`)

**Files:**
- Modify: `server/routes/admin.ts`
- Test: `tests/server/admin-invite-email.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/admin-invite-email.test.ts` — verify the invite route calls `sendEmail` and still returns ok even if `sendEmail` rejects. Follow the existing inline app/token pattern from `tests/server/admin-route.test.ts` (no shared harness — build the app per file):
```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const sendEmailMock = vi.fn(async () => {})
vi.mock('../../server/services/email', () => ({ sendEmail: sendEmailMock, sendEmailsThrottled: vi.fn() }))

import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, allowedEmails, refreshTokens } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import adminRouter from '../../server/routes/admin'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)   // adminRouter applies requireAdmin internally

describe('POST /api/admin/invites sends an invite email', () => {
  let token: string
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete(refreshTokens); await db.delete(allowedEmails); await db.delete(users)
    const [u] = await db.insert(users).values({ label: 'admin', email: 'admin@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'admin@x.com', name: 'A', role: 'admin' })
  })

  it('calls sendEmail with the invite template', async () => {
    await request(app).post('/api/admin/invites')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'New@Example.com', role: 'member' })
      .expect(200)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.com', template: 'invite' }))
  })

  it('still returns ok when sendEmail rejects', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('smtp down'))
    await request(app).post('/api/admin/invites')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'two@example.com', role: 'member' })
      .expect(200)
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/admin-invite-email.test.ts`
Expected: FAIL — `sendEmail` not called (wiring absent).

- [ ] **Step 3: Wire the invite email**

In `server/routes/admin.ts`, import `sendEmail`:
```ts
import { sendEmail } from '../services/email'
```
In the `POST /invites` handler, after the invite is persisted (`await authRepo.addInvite(...)` or equivalent) and before sending the response, add:
```ts
void sendEmail({
  to: email.trim().toLowerCase(),
  template: 'invite',
  params: {
    siteUrl: process.env.PUBLIC_SITE_URL ?? '',
    roleLine: grantedRole === 'admin' ? ' (מנהל)' : '',
  },
}).catch((e) => console.error('[email] invite send failed:', e))
```
Use whatever the handler's local variables are for the email and granted role (match the existing code; the response shape is unchanged).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/admin-invite-email.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/admin.ts tests/server/admin-invite-email.test.ts
git commit -m "feat(email): send invitation email on admin invite (best-effort)"
```

---

## Task 8: Email-alerts preference — repo, route, types

**Files:**
- Modify: `server/repositories/users-repository.ts`, `server/routes/auth.ts`, `src/types.ts`
- Test: `tests/server/auth-me-email-alerts.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/auth-me-email-alerts.test.ts` (inline app + token, per `tests/server/auth-route.test.ts`):
```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
vi.mock('../../server/services/email', () => ({ sendEmail: vi.fn(), sendEmailsThrottled: vi.fn() }))
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import authRouter from '../../server/routes/auth'

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)

describe('PATCH /api/auth/me email_alerts', () => {
  let token: string
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(users)
    const [u] = await db.insert(users).values({ label: 'member', email: 'm@x.com', name: 'M', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'm@x.com', name: 'M', role: 'member' })
  })

  it('GET /me includes emailAlerts (default true)', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200)
    expect(res.body.user.emailAlerts).toBe(true)
  })

  it('PATCH /me toggles emailAlerts', async () => {
    const res = await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ emailAlerts: false }).expect(200)
    expect(res.body.user.emailAlerts).toBe(false)
  })

  it('PATCH /me with non-boolean returns 400', async () => {
    await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ emailAlerts: 'nope' }).expect(400)
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/auth-me-email-alerts.test.ts`
Expected: FAIL — `PATCH /me` 404 and `emailAlerts` absent.

> **Auth model (verified):** the auth user is `AuthUser = { id, email, name, role }`, built by `toUser()` in `server/repositories/auth-repository.ts` and surfaced through `publicUser()` in `server/routes/auth.ts`. `GET /me` loads via `authRepo.findUserById`. The preference threads through these, NOT `UsersRepository`.

- [ ] **Step 3: Thread `emailAlerts` through `AuthUser` + `toUser` + add `setEmailAlerts`**

In `server/repositories/auth-repository.ts`:
- Add to the `AuthUser` interface: `emailAlerts: boolean`.
- Update `toUser` to include it:
```ts
function toUser(row: typeof users.$inferSelect): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, emailAlerts: row.emailAlerts }
}
```
- Add a setter method to the `AuthRepository` class:
```ts
async setEmailAlerts(id: number, value: boolean): Promise<void> {
  await db.update(users).set({ emailAlerts: value }).where(eq(users.id, id))
}
```
(`eq` and `users` are already imported.) This propagates `emailAlerts` to every `AuthUser` (`findUserById`, `upsertUserFromGoogle`, `findUserByEmail`, `listUsers`, and `rotateRefreshToken().user`). `issueAccessToken` only reads `userId`/`role`, so the JWT is unaffected.

- [ ] **Step 4: Include `emailAlerts` in `publicUser` + add `PATCH /me`**

In `server/routes/auth.ts`, widen `publicUser`:
```ts
function publicUser(u: { id: number; email: string | null; name: string | null; role: string; emailAlerts: boolean }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailAlerts: u.emailAlerts }
}
```
Then add the route (after `GET /me`):
```ts
router.patch('/me', requireAuth, async (req, res) => {
  const { emailAlerts } = req.body ?? {}
  if (typeof emailAlerts !== 'boolean') return res.status(400).json({ error: 'emailAlerts must be boolean' })
  await authRepo.setEmailAlerts(req.user!.id, emailAlerts)
  const user = await authRepo.findUserById(req.user!.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: publicUser(user) })
})
```

- [ ] **Step 5: Add `emailAlerts` to the frontend `User` type**

In `src/types.ts`, in the `User` interface (around line 96, where `email` lives), add:
```ts
  emailAlerts?: boolean
```

- [ ] **Step 6: Run the new test + auth regression suite**

Run: `npx vitest run tests/server/auth-me-email-alerts.test.ts tests/server/auth-route.test.ts tests/server/auth-repository.test.ts`
Expected: the new test PASSES (3 tests). If `auth-route`/`auth-repository` assert an exact user-object shape, update those assertions to include `emailAlerts` (the field is now always returned).

- [ ] **Step 7: Commit**

```bash
git add server/repositories/auth-repository.ts server/routes/auth.ts src/types.ts tests/server/auth-me-email-alerts.test.ts tests/server/auth-route.test.ts tests/server/auth-repository.test.ts
git commit -m "feat(email): email-alerts preference — AuthRepository.setEmailAlerts + PATCH /auth/me"
```

---

## Task 9: `findAlertRecipients` (tracked-bills-repository)

**Files:**
- Modify: `server/repositories/tracked-bills-repository.ts`
- Test: `tests/server/find-alert-recipients.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/find-alert-recipients.test.ts`: seed two users (one member with alerts on, one with alerts off), a `group`-role user, and tracked rows; assert only the eligible personal tracker(s) with email + alerts come back, `[]` for empty input. (Use the same direct-insert seeding style the other repository tests use — insert into `users`, `bills`, `trackedBills` via `db.insert`.)
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, bills, trackedBills } from '../../server/db/schema'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'

const repo = new TrackedBillsRepository()

describe('findAlertRecipients', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(trackedBills); await db.delete(bills); await db.delete(users) })

  it('returns only personal trackers with email + alerts on', async () => {
    const now = new Date()
    const [u1] = await db.insert(users).values({ label: 'a', createdAt: now, email: 'a@x.c', name: 'A', role: 'member', emailAlerts: true }).returning()
    const [u2] = await db.insert(users).values({ label: 'b', createdAt: now, email: 'b@x.c', name: 'B', role: 'member', emailAlerts: false }).returning()
    await db.insert(users).values({ label: 'g', createdAt: now, email: null, name: 'G', role: 'group', emailAlerts: true })
    const [b] = await db.insert(bills).values({ number: '1', title: 'Test Bill', status: 'בוועדה', sourceUrl: 'http://x', knessetNumber: 25 }).returning()
    await db.insert(trackedBills).values([
      { userId: u1.id, billId: b.id, position: 'עוקבים', notes: '', createdAt: now },
      { userId: u2.id, billId: b.id, position: 'עוקבים', notes: '', createdAt: now },
    ])
    const rows = await repo.findAlertRecipients([b.id])
    expect(rows.map((r) => r.email)).toEqual(['a@x.c'])
  })

  it('returns [] for empty input', async () => {
    expect(await repo.findAlertRecipients([])).toEqual([])
  })
})
```

> The `bills` NOT-NULL columns without defaults are `number, title, status, sourceUrl, knessetNumber` (verified in `server/db/schema/bills.ts`); the insert above satisfies them.

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/find-alert-recipients.test.ts`
Expected: FAIL — `findAlertRecipients` is not a function.

- [ ] **Step 3: Implement the query**

In `server/repositories/tracked-bills-repository.ts`, add (import `inArray`, `and`, `eq`, `ne`, `isNotNull` from `drizzle-orm`, and `users` from schema):
```ts
async findAlertRecipients(billIds: number[]): Promise<Array<{ userId: number; email: string; name: string | null; billId: number }>> {
  if (billIds.length === 0) return []
  const rows = await db
    .select({ userId: users.id, email: users.email, name: users.name, billId: trackedBills.billId })
    .from(trackedBills)
    .innerJoin(users, eq(trackedBills.userId, users.id))
    .where(and(
      inArray(trackedBills.billId, billIds),
      ne(users.role, 'group'),
      isNotNull(users.email),
      eq(users.emailAlerts, true),
    ))
  return rows as Array<{ userId: number; email: string; name: string | null; billId: number }>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/find-alert-recipients.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/tracked-bills-repository.ts tests/server/find-alert-recipients.test.ts
git commit -m "feat(email): findAlertRecipients — personal trackers with alerts on"
```

---

## Task 10: Poller digest wiring

**Files:**
- Modify: `server/services/poller.ts`
- Test: `tests/server/poller-digest.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/server/poller-digest.test.ts`: mock `fetchBillStatusById` to return a changed status, mock `email` module, seed two users tracking overlapping bills (one opted out), run `pollBills`, assert exactly one digest queued for the eligible user grouping their changed bills. Model it on the existing `tests/server/poller.test.ts` setup (reuse its mocks for the Knesset fetchers).
```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const throttledMock = vi.fn(async () => {})
vi.mock('../../server/services/email', () => ({ sendEmail: vi.fn(), sendEmailsThrottled: throttledMock }))
vi.mock('../../server/services/knesset-bills', () => ({ fetchBillStatusById: vi.fn(async () => 'עבר') }))
// ...mock the committee + MK fetchers the poller imports, mirroring tests/server/poller.test.ts

import { setupTestDb } from './db-harness'
import { EmailTemplatesRepository } from '../../server/repositories/email-templates-repository'
// seed helpers + import the poll entry point used by poller.test.ts

const templates = new EmailTemplatesRepository()

describe('poller bill digests', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    vi.clearAllMocks()
    // reset tables, then seed users/bills/tracking (one user alerts-on, one alerts-off)
    // Self-seed the templates the digest renders so the test does not depend on migration 0013:
    templates._resetCache()
    await templates.update('_layout', { subject: '', html: '<x>{{subject}}|{{content}}</x>' })
    await templates.update('bill_digest', { subject: 'D {{count}}', html: '<p>{{name}}{{bills}}</p>' })
    await templates.update('bill_digest_item', { subject: '', html: '<i>{{title}}:{{oldStatus}}->{{newStatus}}</i>' })
  })

  it('queues exactly one digest for an eligible user with their changed bills grouped', async () => {
    // seed: user A (alerts on) tracks bill X whose status will change; user B (alerts off) tracks X
    // run the bill poll, then:
    expect(throttledMock).toHaveBeenCalledOnce()
    const queued = throttledMock.mock.calls[0][0]
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ to: 'a@x.c', template: 'bill_digest', raw: ['bills'] })
  })
})
```

> **Note:** Match the actual poll entry point and fetcher module paths used in `tests/server/poller.test.ts`. If `pollBills` is not exported, either export it or drive the test through the exported cycle function that `poller.test.ts` uses.

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/poller-digest.test.ts`
Expected: FAIL — no digest queued.

- [ ] **Step 3: Wire the digest into `pollBills`**

In `server/services/poller.ts`:
- Import at top: `import { sendEmailsThrottled, type SendArgs } from './email'`, `import { renderTemplate } from './email-render'`, and the `TrackedBillsRepository` instance (or construct one).
- Inside `pollBills`, before the `for` loop, declare: `const changes: Array<{ billId: number; title: string; oldStatus: string; newStatus: string; knessetUrl: string }> = []`.
- In the loop, when `changed` is true, push:
```ts
changes.push({ billId: bill.id, title: bill.title, oldStatus: bill.status ?? '', newStatus, knessetUrl: bill.knessetUrl ?? '' })
```
- After the loop, before returning, add:
```ts
if (changes.length) {
  try {
    const recipients = await trackedBills.findAlertRecipients(changes.map((c) => c.billId))
    const byUser = new Map<number, { email: string; name: string | null; bills: typeof changes }>()
    const changeById = new Map(changes.map((c) => [c.billId, c]))
    for (const r of recipients) {
      const c = changeById.get(r.billId); if (!c) continue
      const e = byUser.get(r.userId) ?? { email: r.email, name: r.name, bills: [] }
      e.bills.push(c); byUser.set(r.userId, e)
    }
    const queued: SendArgs[] = []
    for (const u of byUser.values()) {
      const items = await Promise.all(u.bills.map((c) =>
        renderTemplate('bill_digest_item', { title: c.title, oldStatus: c.oldStatus, newStatus: c.newStatus, knessetUrl: c.knessetUrl })
          .then((r) => r.html)))
      queued.push({ to: u.email, template: 'bill_digest', params: { name: u.name ?? '', count: String(u.bills.length), bills: items.join('') }, raw: ['bills'] })
    }
    await sendEmailsThrottled(queued)
  } catch (e) {
    console.error('[poller] digest send failed:', e)
  }
}
```
This block must not affect the boolean the function returns (best-effort).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/server/poller-digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing poller test to confirm no regression**

Run: `npx vitest run tests/server/poller.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/poller.ts tests/server/poller-digest.test.ts
git commit -m "feat(email): poller queues per-member bill-status digest each cycle"
```

---

## Task 11: Resend delivery webhook

**Files:**
- Create: `server/routes/webhooks.ts`
- Modify: `server/index.ts` (mount BEFORE `express.json()`)
- Test: `tests/server/webhook-resend.test.ts`
- Add dependency: `svix`

- [ ] **Step 1: Install svix**

Run: `npm install svix`

- [ ] **Step 2: Write the failing test**

`tests/server/webhook-resend.test.ts`: build a tiny app mounting only the webhook router with `express.raw`, sign a payload with a known secret via svix's `Webhook`, post it, and assert the matching `sent_emails` row flips to `delivered`; bad signature → 400; unknown id → 200 no-op.
```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { Webhook } from 'svix'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { sentEmails } from '../../server/db/schema'
import { SentEmailsRepository } from '../../server/repositories/sent-emails-repository'
import webhooksRouter from '../../server/routes/webhooks'

const SECRET = 'whsec_' + Buffer.from('testsecret_testsecret_test').toString('base64')

function appWith() {
  const app = express()
  app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter)
  return app
}
function signed(payload: object) {
  const body = JSON.stringify(payload)
  const wh = new Webhook(SECRET)
  const id = 'msg_test'; const timestamp = new Date()
  const signature = wh.sign(id, timestamp, body)
  return { body, headers: { 'svix-id': id, 'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)), 'svix-signature': signature } }
}

describe('POST /api/webhooks/resend', () => {
  beforeAll(async () => { await setupTestDb(); process.env.RESEND_WEBHOOK_SECRET = SECRET })
  beforeEach(async () => { await db.delete(sentEmails) })

  it('updates status to delivered on a valid signed event', async () => {
    await new SentEmailsRepository().record({ id: 'm1', toEmail: 'a@b.c', template: 'invite', subject: 'S', status: 'sent' })
    const { body, headers } = signed({ type: 'email.delivered', data: { email_id: 'm1' } })
    await request(appWith()).post('/api/webhooks/resend').set(headers).set('content-type', 'application/json').send(body).expect(200)
    expect((await new SentEmailsRepository().get('m1'))?.status).toBe('delivered')
  })

  it('rejects a bad signature with 400', async () => {
    await request(appWith()).post('/api/webhooks/resend')
      .set({ 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,bad' })
      .set('content-type', 'application/json').send(JSON.stringify({ type: 'email.delivered', data: { email_id: 'm1' } }))
      .expect(400)
  })

  it('returns 200 no-op for unknown email id', async () => {
    const { body, headers } = signed({ type: 'email.delivered', data: { email_id: 'ghost' } })
    await request(appWith()).post('/api/webhooks/resend').set(headers).set('content-type', 'application/json').send(body).expect(200)
  })
})
```

> If svix's `sign`/`verify` API differs in the installed version, adjust the helper to match (the verify call in the route is the contract that matters).

- [ ] **Step 3: Run it to verify failure**

Run: `npx vitest run tests/server/webhook-resend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the webhook route**

`server/routes/webhooks.ts`:
```ts
import { Router, type Request, type Response } from 'express'
import { Webhook } from 'svix'
import { SentEmailsRepository } from '../repositories/sent-emails-repository'

const router = Router()
const sentEmails = new SentEmailsRepository()

const STATUS_BY_TYPE: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delivery_delayed',
}

// Public, raw-body route. Mounted with express.raw upstream so req.body is a Buffer.
router.post('/resend', async (req: Request, res: Response) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) { res.status(500).json({ error: 'webhook not configured' }); return }
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body)
  let evt: { type: string; data: { email_id?: string } }
  try {
    evt = new Webhook(secret).verify(raw, {
      'svix-id': String(req.header('svix-id') ?? ''),
      'svix-timestamp': String(req.header('svix-timestamp') ?? ''),
      'svix-signature': String(req.header('svix-signature') ?? ''),
    }) as typeof evt
  } catch {
    res.status(400).json({ error: 'invalid signature' }); return
  }
  const status = STATUS_BY_TYPE[evt.type]
  const id = evt.data?.email_id
  if (status && id) await sentEmails.updateStatus(id, status)
  res.status(200).json({ ok: true })
})

export default router
```

- [ ] **Step 5: Mount it before the JSON body parser**

In `server/index.ts`, add the import and mount the webhook router **above** `app.use(express.json())` (line ~36) so the raw body survives:
```ts
import webhooksRouter from './routes/webhooks'
// ...
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRouter)
app.use(express.json())
```
(Place the webhook mount after CORS but before `express.json()`. The webhook path is excluded from JSON parsing by virtue of being mounted first with its own raw parser.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/server/webhook-resend.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add server/routes/webhooks.ts server/index.ts tests/server/webhook-resend.test.ts package.json package-lock.json
git commit -m "feat(email): Resend delivery webhook (svix-verified) + raw-body mount"
```

---

## Task 12: Admin template editor (routes + client + UI)

**Files:**
- Modify: `server/routes/admin.ts`, `src/lib/api-client.ts`, `src/components/admin/AdminPanel.tsx`
- Test: `tests/server/admin-email-templates.test.ts`

- [ ] **Step 1: Write the failing test (routes)**

`tests/server/admin-email-templates.test.ts` (inline app + tokens, per `tests/server/admin-route.test.ts`):
```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
vi.mock('../../server/services/email', () => ({ sendEmail: vi.fn(), sendEmailsThrottled: vi.fn() }))
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import adminRouter from '../../server/routes/admin'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)

describe('admin email-templates routes', () => {
  let admin: string; let member: string
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(users)
    const [a] = await db.insert(users).values({ label: 'admin', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    const [m] = await db.insert(users).values({ label: 'member', email: 'm@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    admin = issueAccessToken({ id: a.id, email: 'a@x.com', name: 'A', role: 'admin' })
    member = issueAccessToken({ id: m.id, email: 'm@x.com', name: 'M', role: 'member' })
  })

  it('GET lists templates for an admin', async () => {
    const res = await request(app).get('/api/admin/email-templates').set('Authorization', `Bearer ${admin}`).expect(200)
    expect(Array.isArray(res.body.templates)).toBe(true)
  })

  it('PUT updates a template', async () => {
    await request(app).put('/api/admin/email-templates/invite').set('Authorization', `Bearer ${admin}`)
      .send({ subject: 'New', html: '<p>x</p>' }).expect(200)
    const res = await request(app).get('/api/admin/email-templates').set('Authorization', `Bearer ${admin}`)
    expect(res.body.templates.find((t: { name: string }) => t.name === 'invite').subject).toBe('New')
  })

  it('non-admin gets 403', async () => {
    await request(app).get('/api/admin/email-templates').set('Authorization', `Bearer ${member}`).expect(403)
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/server/admin-email-templates.test.ts`
Expected: FAIL — routes 404.

- [ ] **Step 3: Add the routes**

In `server/routes/admin.ts` (the router already requires admin — confirm `requireAdmin` is applied at mount in `server/index.ts`; if it is applied per-route, add it here to match the existing invite routes), import and instantiate `EmailTemplatesRepository`, then add:
```ts
import { EmailTemplatesRepository } from '../repositories/email-templates-repository'
const emailTemplates = new EmailTemplatesRepository()

router.get('/email-templates', async (_req, res) => {
  res.json({ templates: await emailTemplates.getAll() })
})

router.put('/email-templates/:name', async (req, res) => {
  const { subject, html } = req.body ?? {}
  if (typeof subject !== 'string' || typeof html !== 'string') { res.status(400).json({ error: 'subject and html required' }); return }
  await emailTemplates.update(req.params.name, { subject, html })
  res.json({ ok: true })
})
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `npx vitest run tests/server/admin-email-templates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add client methods**

In `src/lib/api-client.ts`, inside the `admin` section, add:
```ts
emailTemplates: {
  list: () => apiFetch<{ templates: Array<{ name: string; subject: string; html: string }> }>('/admin/email-templates'),
  update: (name: string, body: { subject: string; html: string }) =>
    apiFetch<{ ok: boolean }>(`/admin/email-templates/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }),
},
```
(Match the surrounding `admin` object's style; if admin methods attach the auth header via a shared helper, follow that.)

- [ ] **Step 6: Add the AdminPanel editor section**

In `src/components/admin/AdminPanel.tsx`, add an "Email templates" (`תבניות מייל`) section: on mount (or tab open) call `api.admin.emailTemplates.list()`, render each template with editable `subject` and `html` textareas and a Save button calling `api.admin.emailTemplates.update(name, { subject, html })`, showing a success/error toast via the existing toast mechanism used elsewhere in the panel. Follow the existing invites/users section layout and styling in this file.

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add server/routes/admin.ts src/lib/api-client.ts src/components/admin/AdminPanel.tsx tests/server/admin-email-templates.test.ts
git commit -m "feat(email): admin email-template editor (routes + client + UI)"
```

---

## Task 13: AuthControl email-alerts toggle

**Files:**
- Modify: `src/lib/api-client.ts`, `src/components/layout/AuthControl.tsx`
- Test: `tests/components/AuthControl.test.tsx` (extend if it exists; else create)

- [ ] **Step 1: Add the client method**

In `src/lib/api-client.ts`, inside the `auth` section, add:
```ts
updateMe: (body: { emailAlerts: boolean }) =>
  apiFetch<{ user: import('@/types').User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
```

- [ ] **Step 2: Write the failing component test**

`tests/components/AuthControl.test.tsx` — render `AuthControl` with a signed-in user (mock `useAuth`/context to provide `user.emailAlerts = true`), assert a checkbox labelled `התראות במייל` is checked; clicking it calls `api.auth.updateMe` with `{ emailAlerts: false }`. Mock `@/lib/api-client`. Follow the existing component-test mocking pattern (`react-i18next` is auto-mocked).

- [ ] **Step 3: Run it to verify failure**

Run: `npx vitest run tests/components/AuthControl.test.tsx`
Expected: FAIL — no checkbox.

- [ ] **Step 4: Add the toggle to AuthControl**

In `src/components/layout/AuthControl.tsx`, in the signed-in branch, render a checkbox labelled `התראות במייל` bound to `user.emailAlerts ?? true`. On change, call `api.auth.updateMe({ emailAlerts: next })`, update the context user with the returned user, and show a success/error toast (reuse the toast used elsewhere in this component). Keep it visually consistent with the existing signed-in controls.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/components/AuthControl.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-client.ts src/components/layout/AuthControl.tsx tests/components/AuthControl.test.tsx
git commit -m "feat(email): email-alerts toggle in AuthControl"
```

---

## Task 14: Widen `Bill.status` type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Widen the union to string**

In `src/types.ts`, change the `Bill.status` field (line ~16) from:
```ts
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה'
```
to:
```ts
  status: string   // Hebrew status label from the full KNS_Status vocabulary; '' if unknown
```

- [ ] **Step 2: Fix any resulting exhaustiveness assumptions**

Run: `npx tsc --noEmit`
Expected: PASS. If any switch/exhaustiveness check on `Bill.status` breaks, replace it with a default/fallback branch (the status is now an open string). Search: `grep -rn "בוועדה\|הצבעה קרובה" src` and confirm no code depends on the union being closed.

- [ ] **Step 3: Run the full test + lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "refactor(types): widen Bill.status to string (full Knesset vocabulary)"
```

---

## Task 15: Env vars + documentation

**Files:**
- Modify: `.env.example`, `CLAUDE.md`, `docs/architecture.md`, `docs/data-schema.md`

- [ ] **Step 1: Add env vars to `.env.example`**

Append (server-side only):
```
# --- Email (Resend) ---
RESEND_API_KEY=                 # Resend API key (unset → email no-ops, app still works)
EMAIL_FROM=Liberal <noreply@yourdomain>
PUBLIC_SITE_URL=https://derlegatlabienus.github.io
RESEND_WEBHOOK_SECRET=          # Svix signing secret from the Resend webhook config
```

- [ ] **Step 2: Document the subsystem**

- `docs/architecture.md`: add an "Email (Resend)" subsection — `email-render` → `email` → Resend, the `sent_emails` lifecycle via webhook, the poller digest path, and that email is best-effort.
- `docs/data-schema.md`: add `email_templates`, `sent_emails`, and `users.email_alerts`.
- `CLAUDE.md`: add the four env vars to any env list and one line that email no-ops when `RESEND_API_KEY` is unset (dev/test default).

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md docs/architecture.md docs/data-schema.md
git commit -m "docs(email): env vars + architecture/data-schema for email subsystem"
```

---

## Task 16: Backlog + full verification

**Files:**
- Modify: `BACKLOG.md`

- [ ] **Step 1: Mark item 3's alerts half done**

In `BACKLOG.md`, update item 3: mark the email/alerts half (#3b) complete with a one-line ✅ note referencing this feature, and confirm the accounts half is already represented.

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all PASS. Record the test count.

- [ ] **Step 3: Commit**

```bash
git add BACKLOG.md
git commit -m "docs(backlog): mark email alerts (#3b) complete"
```

---

## Self-Review Notes

- **Spec coverage:** Tasks map 1:1 to spec components 1–14 (schema→1/2, repos→3/4, render→5, send→6, invite→7, preference→8, recipients→9, poller→10, webhook→11, admin editor→12, toggle→13, type cleanup→14, env→15). Operational Resend/domain setup (spec §"Operational notes") is manual/one-time and intentionally not a code task.
- **YAGNI honored:** no unsubscribe links, no template versioning, no send-retry queue, no committee/MK alerts — matching the spec's "Out of scope."
- **Type consistency:** `SendArgs` (Task 6) is reused by the poller (Task 10); `renderTemplate(name, params, { raw })` signature is identical across Tasks 5/6/10; `findAlertRecipients` shape (Task 9) matches its consumer in Task 10; `sent_emails` columns (Task 1) match `record`/`updateStatus` (Task 4) and the webhook (Task 11).
- **Auth model (verified):** the user preference threads through `AuthUser` + `toUser()` + `publicUser()` and a new `AuthRepository.setEmailAlerts` (Task 8) — `UsersRepository` is NOT the auth store. `GET /me` uses `authRepo.findUserById`. Existing `auth-route`/`auth-repository` tests may assert the user shape and are re-run in Task 8 Step 6.
- **Migrations in tests (verified):** `db-harness.setupTestDb()` calls `runMigrations()`, applying the full migration set (incl. custom INSERT migrations) to per-file pglite. 0013 templates are therefore present in tests; Task 10 additionally self-seeds its templates to stay decoupled.
- **`bills` insert (verified):** NOT-NULL-without-default columns are `number, title, status, sourceUrl, knessetNumber` — Task 9's seed insert satisfies them.
- **Test harness:** verified against the worktree — route tests build the app inline (`express()` + `express.json()` + the router) and mint JWTs via `issueAccessToken({ id, email, name, role })`, seeding users with `db.insert(users)` (pattern from `tests/server/admin-route.test.ts` / `auth-route.test.ts`). `supertest` is already a dependency. The admin router applies `requireAdmin` internally, so mounting it bare is sufficient. No shared harness file needed.
