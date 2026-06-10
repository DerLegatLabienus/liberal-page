# Email via Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add transactional email (Resend) for invite emails and per-cycle bill-status alert digests, with DB-stored editable templates, a log-only delivery webhook, and the email ledger wired into a generalized storage-pressure reclaimer.

**Architecture:** A lazy `email.ts` send primitive renders DB-stored templates (`renderTemplate`/`renderFragment`) and records a minimal `sent_emails` ledger. Invites fire from the admin route; alerts are built by the poller (grouped digest per member) and throttled. Delivery webhooks only log (redacted). `purgeOrphansIfNeeded` becomes a reclaimer pipeline that trims the ledger first.

**Tech Stack:** Express 5, Drizzle + node-postgres (pglite in tests), Vitest, React 18, `resend`, `svix`.

**Spec:** `docs/superpowers/specs/2026-06-04-email-resend-design.md`

**Conventions:**
- Server tests: `npx vitest run tests/server/<file>.test.ts` (node env, pglite via `tests/server/db-harness.ts` `setupTestDb()`).
- Component tests: `npx vitest run tests/components/<file>.test.tsx`.
- Type check: `npx tsc --noEmit`. Lint: `npm run lint`.
- Every task ends with a commit. Conventional-commit messages; end each with the Co-Authored-By trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

## File Structure

**Create:**
- `server/services/email-redaction.ts` — `redactEmail()` (pure, no deps).
- `server/db/schema/email.ts` — `emailTemplates`, `sentEmails` tables.
- `server/repositories/email-templates-repository.ts` — CRUD + name-keyed cache.
- `server/repositories/sent-emails-repository.ts` — `record`/`deleteOldest`/`count`/`list`.
- `server/services/email-render.ts` — `renderTemplate`, `renderFragment`, `escapeHtml`.
- `server/services/email.ts` — `getResend`, `sendEmail`, `sendEmailsThrottled`.
- `server/routes/webhooks.ts` — `POST /resend` (svix-verified, log only).
- Test files under `tests/server/` and `tests/components/` per task.

**Modify:**
- `server/db/schema/tracking.ts` — `users.emailAlerts`.
- `server/db/schema/index.ts` — export `./email`.
- `server/repositories/auth-repository.ts` — `AuthUser.emailAlerts`, `toUser`, `setEmailAlerts`.
- `server/routes/auth.ts` — `publicUser` + `PATCH /me`.
- `server/routes/admin.ts` — invite email + email-template routes.
- `server/repositories/tracked-bills-repository.ts` — `findAlertRecipients`.
- `server/services/poller.ts` — digest send + renamed reclaimer call.
- `server/services/storage-manager.ts` — reclaimer pipeline.
- `server/index.ts` — mount webhook router before `express.json()`.
- `src/types.ts` — widen `Bill.status` to `string`.
- `src/components/parliament/BillCard.tsx` — status maps → `Record<string,string>`.
- `src/lib/api-client.ts` — `AuthUser.emailAlerts`, `api.auth.updateMe`, `api.admin.emailTemplates`.
- `src/components/layout/AuthControl.tsx` — alerts toggle.
- `src/components/admin/AdminPanel.tsx` — email-templates section.
- `.env.example` — email env vars.
- `package.json` — `resend`, `svix` deps.

---

### Task 1: Email redaction helper

**Files:**
- Create: `server/services/email-redaction.ts`
- Test: `tests/server/email-redaction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/email-redaction.test.ts
import { describe, it, expect } from 'vitest'
import { redactEmail } from '../../server/services/email-redaction'

describe('redactEmail', () => {
  it('keeps the local part and drops the domain', () => {
    expect(redactEmail('avivavitan63@gmail.com')).toBe('avivavitan63@…')
  })
  it('returns the ellipsis when there is no @', () => {
    expect(redactEmail('notanemail')).toBe('…')
  })
  it('returns the ellipsis for an empty string', () => {
    expect(redactEmail('')).toBe('…')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/email-redaction.test.ts`
Expected: FAIL — cannot find module `email-redaction`.

- [ ] **Step 3: Implement**

```ts
// server/services/email-redaction.ts

/** Redact an email for logs: keep the local part, drop the domain. 'a@b.com' -> 'a@…'. */
export function redactEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '…'
  return `${email.slice(0, at)}@…`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/email-redaction.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/email-redaction.ts tests/server/email-redaction.test.ts
git commit -m "feat(email): add redactEmail log helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Dependencies + env documentation

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install resend svix
```
Expected: `resend` and `svix` added to `package.json` `dependencies`; lockfile updated.

- [ ] **Step 2: Verify they resolve**

Run: `node -e "require.resolve('resend'); require.resolve('svix'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Document env vars in `.env.example`**

Append to `.env.example`:
```bash

# --- Email (Resend) — all server-side only, never expose to the frontend ---
# API key from the Resend dashboard. Unset = email is a no-op (dev/test never send).
# RESEND_API_KEY=re_xxx
# Verified sender; must match a domain verified in Resend.
# EMAIL_FROM=Liberal <noreply@yourdomain>
# Link target used in invitation emails.
# PUBLIC_SITE_URL=https://derlegatlabienus.github.io
# Svix signing secret from the Resend webhook config (delivery events).
# RESEND_WEBHOOK_SECRET=whsec_xxx
# Optional: rows trimmed per cycle from the sent_emails ledger under storage pressure (default 500).
# SENT_EMAIL_PURGE_BATCH=500
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "build(email): add resend + svix deps and document email env

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Schema — users.email_alerts, email_templates, sent_emails

**Files:**
- Modify: `server/db/schema/tracking.ts:6-15`
- Create: `server/db/schema/email.ts`
- Modify: `server/db/schema/index.ts`

- [ ] **Step 1: Add `emailAlerts` to `users`**

In `server/db/schema/tracking.ts`, update the imports and the `users` table:

```ts
import { pgTable, serial, integer, text, timestamp, unique, boolean } from 'drizzle-orm/pg-core'
```
Add this column to the `users` table definition (after `role`):
```ts
  emailAlerts: boolean('email_alerts').notNull().default(true),
```

- [ ] **Step 2: Create the email schema file**

```ts
// server/db/schema/email.ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Editable email templates rendered with {{placeholder}} substitution.
// Rows: '_layout', 'invite', 'bill_digest', 'bill_digest_item'.
export const emailTemplates = pgTable('email_templates', {
  name: text('name').primaryKey(),
  subject: text('subject').notNull().default(''),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Minimal send ledger: recorded once at send time, never updated. Delivery lifecycle
// is logged only (see webhook). First table trimmed under storage pressure.
export const sentEmails = pgTable('sent_emails', {
  id: text('id').primaryKey(),            // Resend message id, or 'failed:<uuid>' on send error
  toEmail: text('to_email').notNull(),
  template: text('template').notNull(),
  status: text('status').notNull().default('sent'), // 'sent' | 'failed'
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 3: Export from the schema barrel**

In `server/db/schema/index.ts`, add at the end:
```ts
export * from './email'
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `server/db/migrations/0012_*.sql` adding `users.email_alerts`, `email_templates`, and `sent_emails`. Open it and confirm it contains `ADD COLUMN "email_alerts"`, `CREATE TABLE "email_templates"`, and `CREATE TABLE "sent_emails"`.

- [ ] **Step 5: Verify it applies (type check + a server test that boots pglite)**

Run: `npx vitest run tests/server/storage-manager.test.ts`
Expected: PASS (the harness applies the new migration cleanly).

- [ ] **Step 6: Commit**

```bash
git add server/db/schema/tracking.ts server/db/schema/email.ts server/db/schema/index.ts server/db/migrations/
git commit -m "feat(email): schema for email_alerts, email_templates, sent_emails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Seed default templates (custom migration)

**Files:**
- Create: `server/db/migrations/0013_seed_email_templates.sql`

- [ ] **Step 1: Generate an empty custom migration**

Run: `npx drizzle-kit generate --custom --name seed_email_templates`
Expected: creates `server/db/migrations/0013_seed_email_templates.sql` (empty) and updates `meta/_journal.json`.

- [ ] **Step 2: Fill the migration with the 4 seed rows**

Put this exact content in `server/db/migrations/0013_seed_email_templates.sql` (each statement separated by `--> statement-breakpoint`; HTML uses only double quotes so it is safe inside single-quoted SQL literals):

```sql
INSERT INTO "email_templates" ("name","subject","html") VALUES
('_layout','','<!doctype html><html dir="rtl" lang="he"><body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;margin:0;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px"><h2 style="color:#0f172a;margin:0 0 16px">{{subject}}</h2>{{content}}<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/><p style="color:#94a3b8;font-size:12px;margin:0">המעקב הפרלמנטרי</p></div></body></html>')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "email_templates" ("name","subject","html") VALUES
('invite','הוזמנת למעקב הפרלמנטרי','<p style="color:#334155">הוזמנת לעקוב אחר הפעילות הפרלמנטרית.{{roleLine}}</p><p style="color:#334155">להתחברות, היכנס/י עם חשבון Google של כתובת מייל זו:</p><p><a href="{{siteUrl}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px">כניסה למערכת</a></p>')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "email_templates" ("name","subject","html") VALUES
('bill_digest','עדכון בהצעות חוק שאתה עוקב אחריהן ({{count}})','<p style="color:#334155">שלום {{name}},</p><p style="color:#334155">חל שינוי בסטטוס של הצעות חוק שאת/ה עוקב/ת אחריהן:</p><ul style="padding-inline-start:18px;color:#334155">{{bills}}</ul>')
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "email_templates" ("name","subject","html") VALUES
('bill_digest_item','','<li style="margin-bottom:10px"><a href="{{knessetUrl}}" style="color:#2563eb;text-decoration:none">{{title}}</a><br/><span style="color:#64748b;font-size:13px">{{newStatus}} ← {{oldStatus}}</span></li>')
ON CONFLICT ("name") DO NOTHING;
```

- [ ] **Step 3: Verify the seed applies and rows exist**

Create a throwaway check by running an existing server test that boots pglite, then confirm via a quick test. Add a temporary test `tests/server/email-seed.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { emailTemplates } from '../../server/db/schema'

describe('seeded email templates', () => {
  beforeAll(async () => { await setupTestDb() })
  it('has the 4 default rows', async () => {
    const rows = await db.select().from(emailTemplates)
    const names = rows.map((r) => r.name).sort()
    expect(names).toEqual(['_layout', 'bill_digest', 'bill_digest_item', 'invite'])
  })
})
```

Run: `npx vitest run tests/server/email-seed.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/db/migrations/ tests/server/email-seed.test.ts
git commit -m "feat(email): seed default Hebrew email templates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: EmailTemplatesRepository

**Files:**
- Create: `server/repositories/email-templates-repository.ts`
- Test: `tests/server/email-templates-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/email-templates-repository.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { EmailTemplatesRepository } from '../../server/repositories/email-templates-repository'

const repo = new EmailTemplatesRepository()

describe('EmailTemplatesRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(() => { repo._resetCache() })

  it('reads a seeded template', async () => {
    const t = await repo.get('invite')
    expect(t?.subject).toBe('הוזמנת למעקב הפרלמנטרי')
  })

  it('returns null for an unknown name', async () => {
    expect(await repo.get('nope')).toBeNull()
  })

  it('updates subject/html and reflects it after cache reset', async () => {
    await repo.update('invite', { subject: 'X', html: '<p>Y</p>' })
    repo._resetCache()
    const t = await repo.get('invite')
    expect(t?.subject).toBe('X')
    expect(t?.html).toBe('<p>Y</p>')
  })

  it('lists all templates', async () => {
    const all = await repo.getAll()
    expect(all.length).toBeGreaterThanOrEqual(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/email-templates-repository.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// server/repositories/email-templates-repository.ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { emailTemplates } from '../db/schema'

export interface EmailTemplate { name: string; subject: string; html: string }

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { tpl: EmailTemplate | null; at: number }>()

export class EmailTemplatesRepository {
  _resetCache(): void { cache.clear() }

  async get(name: string): Promise<EmailTemplate | null> {
    const hit = cache.get(name)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.tpl
    const rows = await db.select().from(emailTemplates).where(eq(emailTemplates.name, name))
    const tpl = rows[0] ? { name: rows[0].name, subject: rows[0].subject, html: rows[0].html } : null
    cache.set(name, { tpl, at: Date.now() })
    return tpl
  }

  async getAll(): Promise<EmailTemplate[]> {
    const rows = await db.select().from(emailTemplates)
    return rows.map((r) => ({ name: r.name, subject: r.subject, html: r.html }))
  }

  async update(name: string, patch: { subject: string; html: string }): Promise<void> {
    await db
      .insert(emailTemplates)
      .values({ name, subject: patch.subject, html: patch.html, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: emailTemplates.name,
        set: { subject: patch.subject, html: patch.html, updatedAt: new Date() },
      })
    cache.delete(name)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/email-templates-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/email-templates-repository.ts tests/server/email-templates-repository.test.ts
git commit -m "feat(email): EmailTemplatesRepository with name-keyed cache

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: SentEmailsRepository

**Files:**
- Create: `server/repositories/sent-emails-repository.ts`
- Test: `tests/server/sent-emails-repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/sent-emails-repository.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { sentEmails } from '../../server/db/schema'
import { SentEmailsRepository } from '../../server/repositories/sent-emails-repository'

const repo = new SentEmailsRepository()

describe('SentEmailsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(sentEmails) })

  it('records a send and counts it', async () => {
    await repo.record({ id: 're_1', toEmail: 'a@x.com', template: 'invite', status: 'sent', error: null })
    expect(await repo.count()).toBe(1)
  })

  it('record is idempotent on id', async () => {
    await repo.record({ id: 're_1', toEmail: 'a@x.com', template: 'invite', status: 'sent', error: null })
    await repo.record({ id: 're_1', toEmail: 'a@x.com', template: 'invite', status: 'sent', error: null })
    expect(await repo.count()).toBe(1)
  })

  it('deleteOldest removes the oldest N by createdAt and returns the count', async () => {
    await db.insert(sentEmails).values([
      { id: 'a', toEmail: 'a@x.com', template: 't', status: 'sent', createdAt: new Date('2020-01-01') },
      { id: 'b', toEmail: 'b@x.com', template: 't', status: 'sent', createdAt: new Date('2021-01-01') },
      { id: 'c', toEmail: 'c@x.com', template: 't', status: 'sent', createdAt: new Date('2022-01-01') },
    ])
    const deleted = await repo.deleteOldest(2)
    expect(deleted).toBe(2)
    const remaining = await repo.list(10)
    expect(remaining.map((r) => r.id)).toEqual(['c'])
  })

  it('deleteOldest on empty table returns 0', async () => {
    expect(await repo.deleteOldest(5)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/sent-emails-repository.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// server/repositories/sent-emails-repository.ts
import { asc, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { sentEmails } from '../db/schema'

export interface SentEmailRow { id: string; toEmail: string; template: string; status: string; error: string | null }

export class SentEmailsRepository {
  async record(r: { id: string; toEmail: string; template: string; status: 'sent' | 'failed'; error: string | null }): Promise<void> {
    await db
      .insert(sentEmails)
      .values({ id: r.id, toEmail: r.toEmail, template: r.template, status: r.status, error: r.error, createdAt: new Date() })
      .onConflictDoNothing()
  }

  async deleteOldest(limit: number): Promise<number> {
    if (limit <= 0) return 0
    const rows = await db.select({ id: sentEmails.id }).from(sentEmails).orderBy(asc(sentEmails.createdAt)).limit(limit)
    if (rows.length === 0) return 0
    await db.delete(sentEmails).where(inArray(sentEmails.id, rows.map((r) => r.id)))
    return rows.length
  }

  async count(): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sentEmails)
    return row?.n ?? 0
  }

  async list(limit: number): Promise<SentEmailRow[]> {
    const rows = await db.select().from(sentEmails).orderBy(asc(sentEmails.createdAt)).limit(limit)
    return rows.map((r) => ({ id: r.id, toEmail: r.toEmail, template: r.template, status: r.status, error: r.error }))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/sent-emails-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/sent-emails-repository.ts tests/server/sent-emails-repository.test.ts
git commit -m "feat(email): SentEmailsRepository ledger (record/deleteOldest/count)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Template render layer

**Files:**
- Create: `server/services/email-render.ts`
- Test: `tests/server/email-render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/email-render.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { EmailTemplatesRepository } from '../../server/repositories/email-templates-repository'
import { renderTemplate, renderFragment, escapeHtml } from '../../server/services/email-render'

const repo = new EmailTemplatesRepository()

describe('email-render', () => {
  beforeAll(async () => {
    await setupTestDb()
    await repo.update('_layout', { subject: '', html: '<x>{{subject}}|{{content}}</x>' })
    await repo.update('t_plain', { subject: 'Hi {{name}}', html: '<p>{{name}}</p>' })
    await repo.update('t_raw', { subject: '', html: '<ul>{{items}}</ul>' })
    repo._resetCache()
  })
  beforeEach(() => repo._resetCache())

  it('escapeHtml escapes the dangerous characters', () => {
    expect(escapeHtml('<a&"\'>')).toBe('&lt;a&amp;&quot;&#39;&gt;')
  })

  it('substitutes and HTML-escapes non-raw params, and wraps in _layout', async () => {
    const { subject, html } = await renderTemplate('t_plain', { name: '<b>' })
    expect(subject).toBe('Hi <b>') // subject value returned for the email header
    expect(html).toContain('<p>&lt;b&gt;</p>') // escaped in body
    expect(html).toContain('<x>') // wrapped by layout
  })

  it('injects raw params without escaping', async () => {
    const { html } = await renderTemplate('t_raw', { items: '<li>x</li>' }, { raw: ['items'] })
    expect(html).toContain('<ul><li>x</li></ul>')
  })

  it('renderFragment returns the body only, no layout', async () => {
    const frag = await renderFragment('t_plain', { name: 'Z' })
    expect(frag).toBe('<p>Z</p>')
  })

  it('missing key becomes empty string', async () => {
    const frag = await renderFragment('t_plain', {})
    expect(frag).toBe('<p></p>')
  })

  it('throws on an unknown template', async () => {
    await expect(renderFragment('does_not_exist', {})).rejects.toThrow(/not found/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/email-render.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// server/services/email-render.ts
import { EmailTemplatesRepository } from '../repositories/email-templates-repository'

const repo = new EmailTemplatesRepository()

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function apply(tpl: string, params: Record<string, string>, raw: Set<string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = params[key] ?? ''
    return raw.has(key) ? v : escapeHtml(v)
  })
}

/** Render a template's body only (no layout). Used for repeating fragments like digest items. */
export async function renderFragment(
  name: string,
  params: Record<string, string>,
  opts?: { raw?: string[] },
): Promise<string> {
  const tpl = await repo.get(name)
  if (!tpl) throw new Error(`email template not found: ${name}`)
  return apply(tpl.html, params, new Set(opts?.raw ?? []))
}

/** Render a full email: fill the named body, then wrap it in the _layout template. */
export async function renderTemplate(
  name: string,
  params: Record<string, string>,
  opts?: { raw?: string[] },
): Promise<{ subject: string; html: string }> {
  const tpl = await repo.get(name)
  if (!tpl) throw new Error(`email template not found: ${name}`)
  const layout = await repo.get('_layout')
  if (!layout) throw new Error('email template not found: _layout')
  const raw = new Set(opts?.raw ?? [])
  const subject = apply(tpl.subject, params, raw)
  const body = apply(tpl.html, params, raw)
  const html = apply(layout.html, { subject, content: body }, new Set(['content']))
  return { subject, html }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/email-render.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/email-render.ts tests/server/email-render.test.ts
git commit -m "feat(email): DB-template render layer (renderTemplate/renderFragment)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Send primitive (email.ts)

**Files:**
- Create: `server/services/email.ts`
- Test: `tests/server/email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/email.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendMock = vi.fn()
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })) }))

const recordMock = vi.fn()
vi.mock('../../server/repositories/sent-emails-repository', () => ({
  SentEmailsRepository: vi.fn().mockImplementation(() => ({ record: recordMock })),
}))

vi.mock('../../server/services/email-render', () => ({
  renderTemplate: vi.fn().mockResolvedValue({ subject: 'S', html: '<p>H</p>' }),
}))

import { sendEmail, sendEmailsThrottled, _resetResend } from '../../server/services/email'

describe('sendEmail', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetResend(); delete process.env.RESEND_API_KEY; process.env.EMAIL_FROM = 'F <f@x.com>' })

  it('no-ops when RESEND_API_KEY is unset (no client, no record)', async () => {
    await sendEmail({ to: 'a@x.com', template: 'invite', params: {} })
    expect(sendMock).not.toHaveBeenCalled()
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('sends and records "sent" with the Resend id when keyed', async () => {
    process.env.RESEND_API_KEY = 're_test'
    sendMock.mockResolvedValue({ data: { id: 're_123' }, error: null })
    await sendEmail({ to: 'a@x.com', template: 'invite', params: {} })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'F <f@x.com>', to: 'a@x.com', subject: 'S', html: '<p>H</p>' }))
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ id: 're_123', toEmail: 'a@x.com', template: 'invite', status: 'sent' }))
  })

  it('records "failed" and does not throw when send rejects', async () => {
    process.env.RESEND_API_KEY = 're_test'
    sendMock.mockRejectedValue(new Error('boom'))
    await expect(sendEmail({ to: 'a@x.com', template: 'invite', params: {} })).resolves.toBeUndefined()
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', template: 'invite' }))
  })

  it('sendEmailsThrottled sends each message in order', async () => {
    process.env.RESEND_API_KEY = 're_test'
    sendMock.mockResolvedValue({ data: { id: 're_x' }, error: null })
    await sendEmailsThrottled([
      { to: '1@x.com', template: 'bill_digest', params: {} },
      { to: '2@x.com', template: 'bill_digest', params: {} },
    ])
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock.mock.calls[0][0].to).toBe('1@x.com')
    expect(sendMock.mock.calls[1][0].to).toBe('2@x.com')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/email.test.ts`
Expected: FAIL — cannot find module `email`.

- [ ] **Step 3: Implement**

> SDK note: this assumes `resend.emails.send()` resolves to `{ data: { id }, error }` (current Resend SDK). Confirm against the installed version (`node -e "console.log(require('resend/package.json').version)"`); if the shape differs, adjust the destructuring and the test mock together.

```ts
// server/services/email.ts
import { Resend } from 'resend'
import { randomUUID } from 'crypto'
import { renderTemplate } from './email-render'
import { redactEmail } from './email-redaction'
import { SentEmailsRepository } from '../repositories/sent-emails-repository'

const sentRepo = new SentEmailsRepository()

let client: Resend | null = null
let inited = false

/** Test-only: forget the lazily-built client so env changes take effect. */
export function _resetResend(): void { client = null; inited = false }

export function getResend(): Resend | null {
  if (!inited) {
    inited = true
    const key = process.env.RESEND_API_KEY
    client = key ? new Resend(key) : null
  }
  return client
}

export interface SendArgs {
  to: string
  template: string
  params: Record<string, string>
  raw?: string[]
}

const THROTTLE_MS = 500

/** Fire-and-forget send: never throws. Records a minimal ledger row; logs redacted. */
export async function sendEmail(args: SendArgs): Promise<void> {
  const { to, template, params, raw } = args
  let rendered: { subject: string; html: string }
  try {
    rendered = await renderTemplate(template, params, { raw })
  } catch (err) {
    console.error('[email] render failed template=%s to=%s', template, redactEmail(to), err)
    return
  }
  const resend = getResend()
  if (!resend) {
    console.warn('[email] RESEND_API_KEY unset — skipping send template=%s to=%s', template, redactEmail(to))
    return
  }
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? '', to, subject: rendered.subject, html: rendered.html,
    })
    if (error || !data) throw error ?? new Error('Resend returned no data')
    await sentRepo.record({ id: data.id, toEmail: to, template, status: 'sent', error: null })
    console.info('[email] sent template=%s to=%s msgId=%s', template, redactEmail(to), data.id)
  } catch (err) {
    console.error('[email] send failed template=%s to=%s', template, redactEmail(to), err)
    await sentRepo
      .record({ id: `failed:${randomUUID()}`, toEmail: to, template, status: 'failed', error: String(err) })
      .catch(() => {})
  }
}

/** Send sequentially, spaced to respect Resend's 2 req/s default. */
export async function sendEmailsThrottled(messages: SendArgs[]): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    await sendEmail(messages[i])
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/email.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/email.ts tests/server/email.test.ts
git commit -m "feat(email): lazy Resend send primitive + throttled batch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Wire invitation emails into the admin route

**Files:**
- Modify: `server/routes/admin.ts:1-23`
- Test: `tests/server/admin-invite-email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/admin-invite-email.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const sendEmailMock = vi.fn()
vi.mock('../../server/services/email', () => ({ sendEmail: sendEmailMock }))

const addInviteMock = vi.fn()
vi.mock('../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({
    addInvite: addInviteMock, listInvites: vi.fn(), removeInvite: vi.fn(),
    listUsers: vi.fn(), findUserById: vi.fn(), countAdmins: vi.fn(), setUserRole: vi.fn(),
  })),
}))

vi.mock('../../server/middleware/auth', () => ({
  requireAdmin: (req: any, _res: any, next: any) => { req.user = { id: 1, role: 'admin' }; next() },
}))

import adminRouter from '../../server/routes/admin'

function app() {
  const a = express(); a.use(express.json()); a.use('/api/admin', adminRouter); return a
}

describe('POST /api/admin/invites email', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.PUBLIC_SITE_URL = 'https://site' })

  it('sends an invite email after adding the invite', async () => {
    addInviteMock.mockResolvedValue(undefined)
    sendEmailMock.mockResolvedValue(undefined)
    const res = await request(app()).post('/api/admin/invites').send({ email: 'New@X.com', role: 'member' })
    expect(res.status).toBe(200)
    expect(addInviteMock).toHaveBeenCalledWith('new@x.com', 'member', 1)
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@x.com', template: 'invite', params: expect.objectContaining({ siteUrl: 'https://site' }),
    }))
  })

  it('still returns ok when the email send rejects', async () => {
    addInviteMock.mockResolvedValue(undefined)
    sendEmailMock.mockRejectedValue(new Error('mail down'))
    const res = await request(app()).post('/api/admin/invites').send({ email: 'a@x.com' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
```

> Note: if `supertest` is not already a dev dependency, install it: `npm install -D supertest @types/supertest`. Check first with `node -e "require.resolve('supertest')"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-invite-email.test.ts`
Expected: FAIL — `sendEmail` not called (no wiring yet).

- [ ] **Step 3: Implement the wiring**

In `server/routes/admin.ts`, add the import at the top:
```ts
import { sendEmail } from '../services/email'
```
Replace the `POST /invites` handler body so it sends after adding:
```ts
router.post('/invites', async (req, res) => {
  const { email, role } = req.body as { email?: string; role?: string }
  if (!email) return res.status(400).json({ error: 'email required' })
  const grantRole = role === 'admin' ? 'admin' : 'member'
  const normalized = email.trim().toLowerCase()
  await authRepo.addInvite(normalized, grantRole, req.user!.id)
  void sendEmail({
    to: normalized,
    template: 'invite',
    params: {
      siteUrl: process.env.PUBLIC_SITE_URL ?? '',
      roleLine: grantRole === 'admin' ? ' הוקצתה לך הרשאת מנהל.' : '',
    },
  }).catch((e) => console.error('[email] invite send failed:', e))
  res.json({ ok: true })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/admin-invite-email.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/admin.ts tests/server/admin-invite-email.test.ts package.json package-lock.json
git commit -m "feat(email): send invitation email on admin invite (fire-and-forget)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: email_alerts plumbing (repo + auth payload + PATCH /me)

**Files:**
- Modify: `server/repositories/auth-repository.ts:5-13` and add method near line 110
- Modify: `server/routes/auth.ts:11-13,56-62`
- Test: `tests/server/auth-me-preferences.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/auth-me-preferences.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const findUserById = vi.fn()
const setEmailAlerts = vi.fn()
vi.mock('../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({ findUserById, setEmailAlerts })),
}))
vi.mock('../../server/middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: 'member' }; next() },
}))
vi.mock('../../server/services/auth-service', () => ({
  verifyGoogleIdToken: vi.fn(), issueAccessToken: vi.fn(), issueRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(), revokeRefreshToken: vi.fn(),
}))

import authRouter from '../../server/routes/auth'

function app() { const a = express(); a.use(express.json()); a.use('/api/auth', authRouter); return a }

describe('PATCH /api/auth/me', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates emailAlerts and returns the updated user', async () => {
    setEmailAlerts.mockResolvedValue(undefined)
    findUserById.mockResolvedValue({ id: 7, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: false })
    const res = await request(app()).patch('/api/auth/me').send({ emailAlerts: false })
    expect(res.status).toBe(200)
    expect(setEmailAlerts).toHaveBeenCalledWith(7, false)
    expect(res.body.user).toEqual({ id: 7, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: false })
  })

  it('rejects a non-boolean body with 400', async () => {
    const res = await request(app()).patch('/api/auth/me').send({ emailAlerts: 'nope' })
    expect(res.status).toBe(400)
    expect(setEmailAlerts).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/auth-me-preferences.test.ts`
Expected: FAIL — route returns 404/handler missing or `setEmailAlerts` undefined.

- [ ] **Step 3: Implement repo changes**

In `server/repositories/auth-repository.ts`, extend the `AuthUser` interface and `toUser`:
```ts
export interface AuthUser {
  id: number
  email: string | null
  name: string | null
  role: string
  emailAlerts: boolean
}

function toUser(row: typeof users.$inferSelect): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, emailAlerts: row.emailAlerts }
}
```
Add a method to the `AuthRepository` class (e.g. after `setUserRole`):
```ts
  async setEmailAlerts(id: number, value: boolean): Promise<void> {
    await db.update(users).set({ emailAlerts: value }).where(eq(users.id, id))
  }
```

- [ ] **Step 4: Implement route changes**

In `server/routes/auth.ts`, widen `publicUser` and add the `PATCH /me` route. Update the `publicUser` signature/body:
```ts
function publicUser(u: { id: number; email: string | null; name: string | null; role: string; emailAlerts: boolean }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, emailAlerts: u.emailAlerts }
}
```
Add after the existing `GET /me` route:
```ts
router.patch('/me', requireAuth, async (req, res) => {
  const { emailAlerts } = req.body as { emailAlerts?: unknown }
  if (typeof emailAlerts !== 'boolean') return res.status(400).json({ error: 'emailAlerts must be boolean' })
  await authRepo.setEmailAlerts(req.user!.id, emailAlerts)
  const user = await authRepo.findUserById(req.user!.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: publicUser(user) })
})
```

- [ ] **Step 5: Run the test + type check**

Run: `npx vitest run tests/server/auth-me-preferences.test.ts && npx tsc --noEmit`
Expected: tests PASS (2); tsc clean (the new `emailAlerts` field flows through `publicUser` everywhere it's used).

- [ ] **Step 6: Commit**

```bash
git add server/repositories/auth-repository.ts server/routes/auth.ts tests/server/auth-me-preferences.test.ts
git commit -m "feat(email): email_alerts preference (repo, auth payload, PATCH /me)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: findAlertRecipients query

**Files:**
- Modify: `server/repositories/tracked-bills-repository.ts:1-7` and add method
- Test: `tests/server/find-alert-recipients.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/find-alert-recipients.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, bills, trackedBills } from '../../server/db/schema'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'

const repo = new TrackedBillsRepository()

async function addUser(email: string | null, role: string, emailAlerts: boolean) {
  const [u] = await db.insert(users).values({ label: email ?? role, email, role, emailAlerts, createdAt: new Date() }).returning({ id: users.id })
  return u.id
}
async function addBill(num: string) {
  const [b] = await db.insert(bills).values({ number: num, title: `b${num}`, status: 'בוועדה', sourceUrl: `https://x/${num}`, knessetNumber: 25 }).returning({ id: bills.id })
  return b.id
}

describe('findAlertRecipients', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(trackedBills); await db.delete(bills); await db.delete(users) })

  it('returns only personal trackers with an email and alerts on', async () => {
    const member = await addUser('m@x.com', 'member', true)
    const muted = await addUser('mute@x.com', 'member', false)
    const group = await addUser(null, 'group', true)
    const b1 = await addBill('1')
    for (const uid of [member, muted, group]) await db.insert(trackedBills).values({ userId: uid, billId: b1, createdAt: new Date() })

    const rows = await repo.findAlertRecipients([b1])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: member, email: 'm@x.com', billId: b1 })
  })

  it('returns [] for empty input', async () => {
    expect(await repo.findAlertRecipients([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/find-alert-recipients.test.ts`
Expected: FAIL — `findAlertRecipients` is not a function.

- [ ] **Step 3: Implement**

In `server/repositories/tracked-bills-repository.ts`, update imports:
```ts
import { and, eq, inArray, ne, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedBills, users } from '../db/schema'
import { BillsRepository } from './bills-repository'
import type { Bill } from '../../src/types'
```
Add this method to the class:
```ts
  /** Personal trackers (role != group, with an email, alerts enabled) of any of the given bills. */
  async findAlertRecipients(
    billIds: number[],
  ): Promise<Array<{ userId: number; email: string; name: string | null; billId: number }>> {
    if (billIds.length === 0) return []
    const rows = await db
      .select({ userId: trackedBills.userId, email: users.email, name: users.name, billId: trackedBills.billId })
      .from(trackedBills)
      .innerJoin(users, eq(trackedBills.userId, users.id))
      .where(and(
        inArray(trackedBills.billId, billIds),
        ne(users.role, 'group'),
        isNotNull(users.email),
        eq(users.emailAlerts, true),
      ))
    return rows.map((r) => ({ userId: r.userId, email: r.email as string, name: r.name, billId: r.billId }))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/find-alert-recipients.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/tracked-bills-repository.ts tests/server/find-alert-recipients.test.ts
git commit -m "feat(email): findAlertRecipients for bill-status alerts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Widen Bill.status type

**Files:**
- Modify: `src/types.ts:16`
- Modify: `src/components/parliament/BillCard.tsx:5-12`
- Modify: `server/repositories/bills-repository.ts:52`

- [ ] **Step 1: Widen the type**

In `src/types.ts`, change line 16 from:
```ts
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה'
```
to:
```ts
  status: string // Hebrew status label from Knesset KNS_Status (full vocabulary)
```

- [ ] **Step 2: Fix the now-incompatible exhaustive maps in BillCard**

In `src/components/parliament/BillCard.tsx`, change the two map type annotations and add fallbacks at the use sites:
```ts
const STATUS_BADGE: Record<string, string> = {
```
```ts
const STATUS_BAR: Record<string, string> = {
```
At the use sites (lines ~30 and ~34), add a fallback so an unmapped status still renders:
```ts
      <div className={`w-1 shrink-0 ${STATUS_BAR[bill.status] ?? 'bg-slate-300'}`} />
```
```ts
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[bill.status] ?? 'bg-slate-100 text-slate-700'}`}>
```

- [ ] **Step 3: Relax the repo cast**

In `server/repositories/bills-repository.ts:52`, change:
```ts
      status: row.status as Bill['status'],
```
to:
```ts
      status: row.status ?? '',
```

- [ ] **Step 4: Type check + run the BillCard component tests if any**

Run: `npx tsc --noEmit`
Expected: clean. Then run the existing suite to confirm nothing regressed:
Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/components/parliament/BillCard.tsx server/repositories/bills-repository.ts
git commit -m "refactor(types): widen Bill.status to string (full Knesset vocabulary)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Poller bill-status alert digests

**Files:**
- Modify: `server/services/poller.ts` (imports, `pollBills` body)
- Test: `tests/server/poller-alerts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/poller-alerts.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const findAlertRecipients = vi.fn()
vi.mock('../../server/repositories/tracked-bills-repository', () => ({
  TrackedBillsRepository: vi.fn().mockImplementation(() => ({ findAlertRecipients })),
}))
const renderFragment = vi.fn().mockResolvedValue('<li>item</li>')
vi.mock('../../server/services/email-render', () => ({ renderFragment }))
const sendEmailsThrottled = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/services/email', () => ({ sendEmailsThrottled }))

import { sendBillAlerts } from '../../server/services/poller'

const CH = (billId: number) => ({ billId, title: `t${billId}`, oldStatus: 'a', newStatus: 'b', knessetUrl: 'u' })

describe('sendBillAlerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends one grouped digest per recipient user', async () => {
    findAlertRecipients.mockResolvedValue([
      { userId: 1, email: 'one@x.com', name: 'One', billId: 10 },
      { userId: 1, email: 'one@x.com', name: 'One', billId: 11 },
      { userId: 2, email: 'two@x.com', name: 'Two', billId: 10 },
    ])
    await sendBillAlerts([CH(10), CH(11)])
    expect(sendEmailsThrottled).toHaveBeenCalledTimes(1)
    const messages = sendEmailsThrottled.mock.calls[0][0]
    expect(messages).toHaveLength(2)
    const u1 = messages.find((m: any) => m.to === 'one@x.com')
    expect(u1.params.count).toBe('2')
    expect(u1.template).toBe('bill_digest')
    expect(u1.raw).toContain('bills')
  })

  it('does nothing when there are no changes', async () => {
    await sendBillAlerts([])
    expect(findAlertRecipients).not.toHaveBeenCalled()
    expect(sendEmailsThrottled).not.toHaveBeenCalled()
  })

  it('does nothing when no one is tracking the changed bills', async () => {
    findAlertRecipients.mockResolvedValue([])
    await sendBillAlerts([CH(10)])
    expect(sendEmailsThrottled).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/poller-alerts.test.ts`
Expected: FAIL — `sendBillAlerts` is not exported.

- [ ] **Step 3a: Export a Knesset bill-URL helper**

A bill's `knessetUrl` column is frequently null (many insert paths don't set it), so the digest must construct the link from `oknesset_id`. `server/services/knesset-bills.ts` has a private `knessetUrl(billId)`; add a public wrapper at the end of that file:
```ts
/** Public bill page URL for a Knesset BillID (a bill's oknesset_id is a BillID). */
export function knessetBillUrl(billId: number): string {
  return knessetUrl(billId)
}
```

- [ ] **Step 3b: Implement in `server/services/poller.ts`**

Add imports near the other imports:
```ts
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'
import { renderFragment } from './email-render'
import { sendEmailsThrottled, type SendArgs } from './email'
import { fetchBillStatusById, knessetBillUrl } from './knesset-bills'
```
(`fetchBillStatusById` is already imported in this file — merge `knessetBillUrl` into that existing import line rather than duplicating it.)
Add a shared instance near the other repo instances:
```ts
const trackedBillsRepo = new TrackedBillsRepository()
```
Add the change type and the exported function (place above `pollBills`):
```ts
export interface BillChange { billId: number; title: string; oldStatus: string | null; newStatus: string; knessetUrl: string }

/** Build and send one grouped digest per member tracking any of the changed bills. */
export async function sendBillAlerts(changes: BillChange[]): Promise<void> {
  if (changes.length === 0) return
  const recipients = await trackedBillsRepo.findAlertRecipients(changes.map((c) => c.billId))
  if (recipients.length === 0) return

  const changeById = new Map(changes.map((c) => [c.billId, c]))
  const byUser = new Map<number, { email: string; name: string | null; bills: BillChange[] }>()
  for (const r of recipients) {
    const change = changeById.get(r.billId)
    if (!change) continue
    const group = byUser.get(r.userId) ?? { email: r.email, name: r.name, bills: [] }
    group.bills.push(change)
    byUser.set(r.userId, group)
  }

  const messages: SendArgs[] = []
  for (const group of byUser.values()) {
    const items = await Promise.all(
      group.bills.map((b) => renderFragment('bill_digest_item', {
        title: b.title, oldStatus: b.oldStatus ?? '', newStatus: b.newStatus, knessetUrl: b.knessetUrl,
      })),
    )
    messages.push({
      to: group.email,
      template: 'bill_digest',
      params: { name: group.name ?? '', count: String(group.bills.length), bills: items.join('') },
      raw: ['bills'],
    })
  }
  await sendEmailsThrottled(messages)
}
```
Now wire it into `pollBills`. Add a `changes` accumulator at the start of the function (before the loop):
```ts
  const changes: BillChange[] = []
```
Inside the loop, right after `const changed = newStatus !== null && newStatus !== bill.status`, add:
```ts
      if (changed) {
        changes.push({
          billId: bill.id, title: bill.title ?? '', oldStatus: bill.status ?? null,
          newStatus: newStatus as string,
          // knessetUrl column is often null; build from the BillID (oknesset_id) as fallback.
          knessetUrl: bill.knessetUrl || knessetBillUrl(Number(bill.oknesset_id)),
        })
      }
```
At the end of `pollBills`, before `return anySuccess`, send the digests in an isolated try/catch so email never affects poll success:
```ts
  try {
    await sendBillAlerts(changes)
  } catch (err) {
    console.error('Poller: bill alert dispatch failed:', err)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/poller-alerts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/poller.ts tests/server/poller-alerts.test.ts
git commit -m "feat(email): poller sends per-cycle bill-status alert digests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Delivery webhook (log only)

**Files:**
- Create: `server/routes/webhooks.ts`
- Modify: `server/index.ts` (import + mount before `express.json()`)
- Test: `tests/server/webhooks-resend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/webhooks-resend.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const verify = vi.fn()
vi.mock('svix', () => ({ Webhook: vi.fn().mockImplementation(() => ({ verify })) }))

import webhooksRouter from '../../server/routes/webhooks'

function app() { const a = express(); a.use('/api/webhooks', webhooksRouter); return a }

describe('POST /api/webhooks/resend', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.RESEND_WEBHOOK_SECRET = 'whsec_x' })

  it('logs a redacted line and returns 200 on a verified event', async () => {
    verify.mockReturnValue({ type: 'email.bounced', data: { email_id: 're_9', to: ['avivavitan63@gmail.com'] } })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await request(app())
      .post('/api/webhooks/resend')
      .set('svix-id', 'a').set('svix-timestamp', 'b').set('svix-signature', 'c')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ any: 'thing' }))
    expect(res.status).toBe(200)
    const logged = info.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('event=bounced')
    expect(logged).toContain('avivavitan63@…')
    expect(logged).toContain('re_9')
    expect(logged).not.toContain('gmail.com')
    info.mockRestore()
  })

  it('returns 400 on a bad signature', async () => {
    verify.mockImplementation(() => { throw new Error('bad sig') })
    const res = await request(app())
      .post('/api/webhooks/resend')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ any: 'thing' }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/webhooks-resend.test.ts`
Expected: FAIL — cannot find module `webhooks`.

- [ ] **Step 3: Implement the router**

```ts
// server/routes/webhooks.ts
import { Router, raw } from 'express'
import { Webhook } from 'svix'
import { redactEmail } from '../services/email-redaction'

const router = Router()

// Resend delivery webhook. Raw body is required for svix signature verification, so this
// route parses its own raw body and is mounted BEFORE the global express.json() middleware.
// It LOGS ONLY (redacted) and stores nothing.
router.post('/resend', raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? ''
  const payload = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body ?? '')
  let event: { type?: string; data?: { email_id?: string; to?: string[] } }
  try {
    event = new Webhook(secret).verify(payload, {
      'svix-id': String(req.headers['svix-id'] ?? ''),
      'svix-timestamp': String(req.headers['svix-timestamp'] ?? ''),
      'svix-signature': String(req.headers['svix-signature'] ?? ''),
    }) as typeof event
  } catch {
    return res.status(400).json({ error: 'invalid signature' })
  }

  const eventName = (event.type ?? 'unknown').replace('email.', '')
  const to = event.data?.to?.[0] ?? ''
  const msgId = event.data?.email_id ?? ''
  console.info('[email] delivery event=%s to=%s msgId=%s', eventName, redactEmail(to), msgId)
  res.status(200).json({ ok: true })
})

export default router
```

- [ ] **Step 4: Mount the router before `express.json()`**

In `server/index.ts`, add the import alongside the others:
```ts
import webhooksRouter from './routes/webhooks'
```
Then mount it immediately BEFORE the `app.use(express.json())` line:
```ts
// Webhooks need the raw body for signature verification, so mount before the JSON parser.
app.use('/api/webhooks', webhooksRouter)
app.use(express.json())
```

- [ ] **Step 5: Run test to verify it passes + type check**

Run: `npx vitest run tests/server/webhooks-resend.test.ts && npx tsc --noEmit`
Expected: tests PASS (2); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add server/routes/webhooks.ts server/index.ts tests/server/webhooks-resend.test.ts
git commit -m "feat(email): log-only Resend delivery webhook (svix-verified, redacted)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: Generalize storage pressure into a reclaimer pipeline

**Files:**
- Modify: `server/services/storage-manager.ts`
- Modify: `server/services/poller.ts:159` (call rename)
- Modify: `tests/server/storage-manager.test.ts` (import + describe rename)
- Test (add cases): `tests/server/storage-manager.test.ts`

- [ ] **Step 1: Add a failing test for the sent-emails reclaimer**

Add these two imports to the **top** of `tests/server/storage-manager.test.ts` (alongside the existing imports — `sentEmails` joins the existing `../../server/db/schema` import; add the repository import as a new line):
```ts
import { SentEmailsRepository } from '../../server/repositories/sent-emails-repository'
```
(Add `sentEmails` to the names already imported from `'../../server/db/schema'`.)

Then append this new describe block at the **end** of the file. Note the pressure config: `OVER` returns 100 MB, so the configured limit must be *below* that to be "over budget" — use `'50:2'` (target = 48 MB):
```ts
describe('relieveStoragePressureIfNeeded — sent_emails reclaimer', () => {
  const sentRepo = new SentEmailsRepository()
  beforeEach(async () => { await db.delete(sentEmails); await setPressure('50:2') })

  it('trims the oldest sent_emails first when over budget', async () => {
    for (let i = 0; i < 3; i++) {
      await db.insert(sentEmails).values({ id: `m${i}`, toEmail: 'a@x.com', template: 't', status: 'sent', createdAt: new Date(2020 + i, 0, 1) })
    }
    process.env.SENT_EMAIL_PURGE_BATCH = '2'
    const r = await relieveStoragePressureIfNeeded(OVER) // 100 MB > 48 MB target
    expect(r.sentEmailsDeleted).toBe(2)
    expect(await sentRepo.count()).toBe(1)
    delete process.env.SENT_EMAIL_PURGE_BATCH
  })

  it('does not trim when under budget', async () => {
    await db.insert(sentEmails).values({ id: 'm0', toEmail: 'a@x.com', template: 't', status: 'sent', createdAt: new Date() })
    const r = await relieveStoragePressureIfNeeded(UNDER) // 1 MB < 48 MB target
    expect(r.sentEmailsDeleted).toBe(0)
    expect(await sentRepo.count()).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/server/storage-manager.test.ts`
Expected: FAIL — `relieveStoragePressureIfNeeded` not exported / `sentEmailsDeleted` missing.

- [ ] **Step 3: Rename the import and existing describe in the test file**

At the top of `tests/server/storage-manager.test.ts`, change:
```ts
import { purgeOrphansIfNeeded, STORAGE_FLAG } from '../../server/services/storage-manager'
```
to:
```ts
import { relieveStoragePressureIfNeeded, STORAGE_FLAG } from '../../server/services/storage-manager'
```
Then replace every `purgeOrphansIfNeeded(` call in the file with `relieveStoragePressureIfNeeded(` and rename the existing top `describe('purgeOrphansIfNeeded', ...)` to `describe('relieveStoragePressureIfNeeded — orphan entities', ...)`.

- [ ] **Step 4: Refactor `server/services/storage-manager.ts`**

Add the import at the top:
```ts
import { SentEmailsRepository } from '../repositories/sent-emails-repository'
```
Add the instance near the others:
```ts
const sentEmailsRepo = new SentEmailsRepository()
```
Extend `PurgeResult` and `ZERO`:
```ts
export interface PurgeResult {
  purged: { bills: number; committees: number; mks: number }
  summariesDeleted: number
  sentEmailsDeleted: number
}

const ZERO: PurgeResult = { purged: { bills: 0, committees: 0, mks: 0 }, summariesDeleted: 0, sentEmailsDeleted: 0 }
```
Replace the body of the current `purgeOrphansIfNeeded` export with a renamed pipeline entry point plus two private reclaimers. Replace the whole `export async function purgeOrphansIfNeeded(...) { ... }` block with:
```ts
type Reclaimer = { name: string; reclaim: (result: PurgeResult) => Promise<number> }

/** Reclaimer 1: trim the oldest sent_emails ledger rows (pure audit data → shed first). */
async function reclaimSentEmails(result: PurgeResult): Promise<number> {
  const batch = num('SENT_EMAIL_PURGE_BATCH') ?? 500
  const deleted = await sentEmailsRepo.deleteOldest(batch)
  result.sentEmailsDeleted += deleted
  if (deleted > 0) console.log(`Storage GC: trimmed ${deleted} sent_emails rows (over budget)`)
  return deleted
}

/** Reclaimer 2: delete the stalest orphan entities (tracked by no one) + their children. */
async function reclaimOrphanEntities(result: PurgeResult): Promise<number> {
  const batchSize = num('ORPHAN_PURGE_BATCH') ?? 5
  const candidates: Candidate[] = [
    ...(await billsRepo.findUntracked()).map((o) => ({ type: 'bill' as const, ...o })),
    ...(await committeesRepo.findUntracked()).map((o) => ({ type: 'committee' as const, ...o })),
    ...(await mksRepo.findUntracked()).map((o) => ({ type: 'mk' as const, ...o })),
  ]
  const ts = (d: Date | null) => (d ? d.getTime() : 0)
  candidates.sort((a, b) => ts(a.lastPolledAt) - ts(b.lastPolledAt) || a.id - b.id)

  let freed = 0
  for (const c of candidates.slice(0, batchSize)) {
    if (c.type === 'bill') {
      await billsRepo.deleteCascade(c.id)
      result.purged.bills++
    } else if (c.type === 'committee') {
      result.summariesDeleted += await summariesRepo.deleteBySourceUrl(c.documentUrl)
      await committeesRepo.deleteCascade(c.id)
      result.purged.committees++
    } else {
      await mksRepo.deleteCascade(c.id)
      result.purged.mks++
    }
    freed++
    console.log(`Storage GC: purged orphan ${c.type} ${c.id} (stalest-first, over budget)`)
  }
  return freed
}

const RECLAIMERS: Reclaimer[] = [
  { name: 'sent_emails', reclaim: reclaimSentEmails },
  { name: 'orphan_entities', reclaim: reclaimOrphanEntities },
]

/**
 * When the database is over budget, run reclaimers cheapest-first, re-measuring between each
 * and stopping once back under budget. One batch per reclaimer per call; recovers gradually
 * across poll cycles. No-op when the storagePressure flag disables it or size is unknown.
 */
export async function relieveStoragePressureIfNeeded(
  usedBytes: () => Promise<number | null>,
): Promise<PurgeResult> {
  const flags = await flagsRepo.getAll()
  const cfg = parsePressureValue(flags[STORAGE_FLAG]?.value)
  if (cfg === null) return ZERO

  let used = await usedBytes()
  if (used === null) return ZERO

  const targetBytes = (cfg.limitMb - cfg.slackMb) * 1024 * 1024
  if (used <= targetBytes) return ZERO

  const result: PurgeResult = { purged: { bills: 0, committees: 0, mks: 0 }, summariesDeleted: 0, sentEmailsDeleted: 0 }
  for (const r of RECLAIMERS) {
    const freed = await r.reclaim(result)
    if (freed > 0) used = await usedBytes()
    if (used !== null && used <= targetBytes) break
  }
  return result
}
```
Note: keep the existing `Candidate`/`OrphanType` interfaces, `num`, `parsePressureValue`, `STORAGE_FLAG`, and the repo instances — only the single public function is replaced/expanded.

- [ ] **Step 5: Update the poller call site**

In `server/services/poller.ts`, change the import:
```ts
import { relieveStoragePressureIfNeeded } from './storage-manager'
```
And the call at line ~159:
```ts
    await relieveStoragePressureIfNeeded(getDatabaseSizeBytes)
```

- [ ] **Step 6: Run the full storage-manager suite**

Run: `npx vitest run tests/server/storage-manager.test.ts`
Expected: PASS — original orphan tests (renamed) plus the 2 new sent-emails reclaimer tests.

- [ ] **Step 7: Commit**

```bash
git add server/services/storage-manager.ts server/services/poller.ts tests/server/storage-manager.test.ts
git commit -m "feat(storage): generalize pressure relief into reclaimer pipeline (ledger trimmed first)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: api-client — emailAlerts, updateMe, email templates

**Files:**
- Modify: `src/lib/api-client.ts` (AuthUser, api.auth, api.admin)

- [ ] **Step 1: Extend the `AuthUser` type**

In `src/lib/api-client.ts:125`, change:
```ts
export interface AuthUser { id: number; email: string | null; name: string | null; role: string; emailAlerts: boolean }
```

- [ ] **Step 2: Add `updateMe` to `api.auth`**

In the `auth:` block (around lines 104-112), add an `updateMe` method:
```ts
    updateMe: (emailAlerts: boolean) =>
      apiFetch<{ user: AuthUser }>(`/auth/me`, { method: 'PATCH', body: JSON.stringify({ emailAlerts }) }),
```

- [ ] **Step 3: Add `emailTemplates` to `api.admin`**

Define the type and add to the `admin:` block:
```ts
export interface EmailTemplate { name: string; subject: string; html: string }
```
Inside `admin:`:
```ts
    emailTemplates: {
      list: () => apiFetch<{ templates: EmailTemplate[] }>(`/admin/email-templates`),
      update: (name: string, body: { subject: string; html: string }) =>
        apiFetch<{ ok: boolean }>(`/admin/email-templates/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }),
    },
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: clean (note: `AuthContext`/`AuthControl` already consume `AuthUser`; adding a required field there will surface in Task 17/18 where we set it — for now any object literals of `AuthUser` live only in tests, which use `AuthResponse` from the server).

If tsc reports an `AuthUser` literal missing `emailAlerts` in non-test source, fix that literal to include `emailAlerts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-client.ts
git commit -m "feat(email): api-client emailAlerts, auth.updateMe, admin.emailTemplates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 17: Admin email-template routes + editor UI

**Files:**
- Modify: `server/routes/admin.ts` (two routes)
- Modify: `src/components/admin/AdminPanel.tsx` (new section)
- Test: `tests/server/admin-email-templates.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
// tests/server/admin-email-templates.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const getAll = vi.fn()
const update = vi.fn()
vi.mock('../../server/repositories/email-templates-repository', () => ({
  EmailTemplatesRepository: vi.fn().mockImplementation(() => ({ getAll, update })),
}))
vi.mock('../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../server/services/email', () => ({ sendEmail: vi.fn() }))
vi.mock('../../server/middleware/auth', () => ({
  requireAdmin: (req: any, _res: any, next: any) => { req.user = { id: 1, role: 'admin' }; next() },
}))

import adminRouter from '../../server/routes/admin'

function app() { const a = express(); a.use(express.json()); a.use('/api/admin', adminRouter); return a }

describe('admin email-template routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists templates', async () => {
    getAll.mockResolvedValue([{ name: 'invite', subject: 'S', html: 'H' }])
    const res = await request(app()).get('/api/admin/email-templates')
    expect(res.status).toBe(200)
    expect(res.body.templates).toEqual([{ name: 'invite', subject: 'S', html: 'H' }])
  })

  it('updates a template', async () => {
    update.mockResolvedValue(undefined)
    const res = await request(app()).put('/api/admin/email-templates/invite').send({ subject: 'X', html: '<p>Y</p>' })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('invite', { subject: 'X', html: '<p>Y</p>' })
  })

  it('rejects an update missing fields with 400', async () => {
    const res = await request(app()).put('/api/admin/email-templates/invite').send({ subject: 'only' })
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/server/admin-email-templates.test.ts`
Expected: FAIL — routes return 404.

- [ ] **Step 3: Implement the routes**

In `server/routes/admin.ts`, add the import:
```ts
import { EmailTemplatesRepository } from '../repositories/email-templates-repository'
```
Add an instance near `authRepo`:
```ts
const emailTemplatesRepo = new EmailTemplatesRepository()
```
Add the two routes (before `export default router`):
```ts
// --- Email templates ---
router.get('/email-templates', async (_req, res) => {
  res.json({ templates: await emailTemplatesRepo.getAll() })
})

router.put('/email-templates/:name', async (req, res) => {
  const { subject, html } = req.body as { subject?: unknown; html?: unknown }
  if (typeof subject !== 'string' || typeof html !== 'string') {
    return res.status(400).json({ error: 'subject and html are required strings' })
  }
  await emailTemplatesRepo.update(req.params.name, { subject, html })
  res.json({ ok: true })
})
```

- [ ] **Step 4: Run the route test**

Run: `npx vitest run tests/server/admin-email-templates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the editor section to `AdminPanel.tsx`**

In `src/components/admin/AdminPanel.tsx`, extend the import to include the template type:
```ts
import { api, type AuthUser, type Invite, type EmailTemplate } from '@/lib/api-client'
```
Add state (near the other `useState` calls):
```ts
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
```
In the `load` callback, also fetch templates (extend the `Promise.all`):
```ts
      const [inv, usr, tpl] = await Promise.all([api.admin.listInvites(), api.admin.listUsers(), api.admin.emailTemplates.list()])
      setInvites(inv.invites)
      setUsers(usr.users)
      setTemplates(tpl.templates)
```
Add a save handler (near `addInvite`):
```ts
  const saveTemplate = async (t: EmailTemplate) => {
    try { await api.admin.emailTemplates.update(t.name, { subject: t.subject, html: t.html }); await load() }
    catch { setError('Failed to save template') }
  }
  const editTemplate = (name: string, patch: Partial<EmailTemplate>) =>
    setTemplates((prev) => prev.map((t) => (t.name === name ? { ...t, ...patch } : t)))
```
Add a new `<section>` after the users section (before the closing wrappers):
```tsx
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('admin.email_templates')}</h3>
            <div className="space-y-4">
              {templates.map((tpl) => (
                <div key={tpl.name} className="rounded border border-border p-3">
                  <p className="mb-1 text-xs font-mono text-muted-foreground">{tpl.name}</p>
                  <input
                    className="mb-2 w-full rounded border px-2 py-1 text-sm"
                    value={tpl.subject}
                    onChange={(e) => editTemplate(tpl.name, { subject: e.target.value })}
                    placeholder="subject"
                  />
                  <textarea
                    className="mb-2 w-full rounded border px-2 py-1 font-mono text-xs"
                    rows={5}
                    value={tpl.html}
                    onChange={(e) => editTemplate(tpl.name, { html: e.target.value })}
                  />
                  <Button size="sm" onClick={() => saveTemplate(tpl)}>{t('admin.save')}</Button>
                </div>
              ))}
            </div>
          </section>
```
Add i18n keys to the Hebrew and English admin namespaces (find the existing `admin.*` keys in `src/i18n` / locale files and add):
```
admin.email_templates → "תבניות מייל" (he) / "Email templates" (en)
admin.save → "שמירה" (he) / "Save" (en)
```

- [ ] **Step 6: Type check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/admin.ts src/components/admin/AdminPanel.tsx src/i18n tests/server/admin-email-templates.test.ts
git commit -m "feat(email): admin email-template editor (routes + panel section)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 18: Alerts opt-out toggle in AuthControl

**Files:**
- Modify: `src/contexts/AuthContext.tsx` (expose a way to update the user)
- Modify: `src/components/layout/AuthControl.tsx` (checkbox)
- Test: `tests/components/AuthControl.test.tsx` (add a case)

- [ ] **Step 1: Expose user updates from AuthContext**

In `src/contexts/AuthContext.tsx`, add `setUser` (or a focused setter) to the context value. Extend `AuthContextValue`:
```ts
  updateUser: (patch: Partial<AuthUser>) => void
```
Implement it inside the provider (near `apply`/`signOut`):
```ts
  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((u) => (u ? { ...u, ...patch } : u))
  }, [])
```
Add `updateUser` to the provider value object:
```tsx
    <AuthContext.Provider value={{ user, ready, signIn, signOut, updateUser }}>
```
And to `useAuthOptional` consumers it's available via the same context.

- [ ] **Step 2: Write a failing test for the toggle**

Add to `tests/components/AuthControl.test.tsx` (the file already mocks `@react-oauth/google` and `@/lib/api-client`). Extend the api-client mock to include `updateMe`, then add a test. First update the mock object in that file:
```ts
    api: { auth: { google: vi.fn(), refresh: vi.fn(), logout: vi.fn(), updateMe: vi.fn() } },
```
Then add:
```ts
  it('toggles email alerts via api.auth.updateMe when signed in', async () => {
    vi.mocked(api.auth.updateMe).mockResolvedValue({
      user: { id: 1, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: false },
    })
    // Sign in first so the control renders the toggle.
    vi.mocked(api.auth.google).mockResolvedValue({
      accessToken: 'a', refreshToken: 'r', user: { id: 1, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: true },
    })
    renderControl()
    await userEvent.click(await screen.findByText('google-signin'))
    const checkbox = await screen.findByRole('checkbox', { name: /alerts|התראות/i })
    await userEvent.click(checkbox)
    expect(api.auth.updateMe).toHaveBeenCalledWith(false)
  })
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/components/AuthControl.test.tsx`
Expected: FAIL — no checkbox rendered.

- [ ] **Step 4: Implement the toggle in `AuthControl.tsx`**

When signed in, render a checkbox bound to `user.emailAlerts`. Use the existing `useAuthOptional`/`useToastOptional`. Add (inside the signed-in branch, near the name/sign-out UI):
```tsx
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          aria-label={t('auth.email_alerts')}
          checked={user.emailAlerts}
          onChange={async (e) => {
            const next = e.target.checked
            try {
              const res = await api.auth.updateMe(next)
              updateUser({ emailAlerts: res.user.emailAlerts })
              toast?.(t('auth.preferences_saved'), 'success')
            } catch {
              toast?.(t('auth.preferences_failed'), 'error')
            }
          }}
        />
        {t('auth.email_alerts')}
      </label>
```
Pull `updateUser` from `useAuthOptional()` alongside `user`. Add i18n keys:
```
auth.email_alerts → "התראות במייל" (he) / "Email alerts" (en)
auth.preferences_saved → "ההעדפה נשמרה" (he) / "Preference saved" (en)
auth.preferences_failed → "שמירת ההעדפה נכשלה" (he) / "Could not save preference" (en)
```

- [ ] **Step 5: Run the component test + type check**

Run: `npx vitest run tests/components/AuthControl.test.tsx && npx tsc --noEmit`
Expected: tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/contexts/AuthContext.tsx src/components/layout/AuthControl.tsx src/i18n tests/components/AuthControl.test.tsx
git commit -m "feat(email): email-alerts opt-out toggle in AuthControl

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 19: Full verification + docs

**Files:**
- Modify: `docs/architecture.md` (email section)
- Modify: `BACKLOG.md` (mark #3b alerts done)

- [ ] **Step 1: Run the entire suite, type check, and lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all tests PASS, tsc clean, lint clean.

- [ ] **Step 2: Document the email subsystem in `docs/architecture.md`**

Add a short "Email (Resend)" subsection under the backend area describing: `email.ts` lazy send + ledger, DB templates + `renderTemplate`/`renderFragment`, invite + digest flows, log-only webhook, and the reclaimer pipeline. Keep it to ~10 lines, matching the file's style.

- [ ] **Step 3: Update `BACKLOG.md`**

Mark backlog item #3b (bill-status email alerts) complete, and note the email infrastructure (invites, DB templates, delivery webhook) shipped with it. Commit immediately per repo convention.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md BACKLOG.md
git commit -m "docs(email): document email subsystem; mark #3b alerts done

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Shared `email.ts` (lazy, no-op without key) → Task 8. ✅
- DB templates + render + admin editor → Tasks 3,4,5,7,16,17. ✅
- Invitation emails (fire-and-forget, every add) → Task 9. ✅
- `email_alerts` + `PATCH /me` + toggle → Tasks 3,10,16,18. ✅
- Poller digest + `findAlertRecipients` + throttle → Tasks 8,11,13. ✅
- `sent_emails` ledger (sent/failed, no updateStatus) → Tasks 3,6,8. ✅
- Log-only webhook + redaction → Tasks 1,14. ✅
- Storage-pressure generalization (ledger trimmed first) → Task 15. ✅
- `Bill.status` widening → Task 12. ✅
- Env + deps → Task 2. ✅
- Operational notes (domain verify, webhook registration) are manual — captured in the spec, not code.

**Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has an exact command + expected result.

**Type consistency:** `SendArgs` (Task 8) is reused verbatim in Task 13. `AuthUser.emailAlerts` added in Task 10 (server) and Task 16 (client). `EmailTemplate` shape identical across Tasks 5/16/17. `PurgeResult.sentEmailsDeleted` defined in Task 15 and asserted in its tests. `findAlertRecipients` return shape (Task 11) matches its consumer grouping (Task 13). `renderFragment`/`renderTemplate` (Task 7) match callers (Tasks 8,13).

**Post-advisor fixes folded in:**
- Task 13 constructs the digest link from `oknesset_id` via a new `knessetBillUrl` export (the `knessetUrl` column is often null), instead of relying on `bill.knessetUrl`.
- Task 15's reclaimer test uses `setPressure('50:2')` so `OVER` (100 MB) actually exceeds the 48 MB target; imports moved to the file top.
- Task 8 notes the Resend `{ data, error }` SDK shape must be confirmed against the installed version.

**Ordering note:** Tasks 1–8 build the email core; 9–14 wire features; 15 generalizes storage; 16–18 frontend; 19 verifies. Each task is independently committable and leaves tests green.
