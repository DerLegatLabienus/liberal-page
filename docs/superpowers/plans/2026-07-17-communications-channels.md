# Multi-channel communications (SMS + WhatsApp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the "letters" system so one campaign can be pushed out over email, SMS, and WhatsApp — each channel carrying its own medium-appropriate content, recipients, and limits — using compose-assist deep links (no backend sender).

**Architecture:** A `letters` row becomes a campaign holding only shared fields; each targeted medium gets a `letter_channels` row with its own body + recipients. Recipients are `contact_id[]` resolved live against a widened `letter_contacts` directory (email + phone + photo). Email keeps its `mailto`/Gmail links; SMS/WhatsApp render as per-recipient `sms:`/`wa.me` deep links. Migration is expand → backfill → contract.

**Tech Stack:** React 18 + Vite, Express 5 + tsx, Postgres (node-postgres) + Drizzle ORM, Vitest (happy-dom for components, node for server, in-memory pglite for DB), i18next (Hebrew-first RTL).

## Global Constraints

- **Keep the `letters` name everywhere** (tables, routes, types, flags, admin UI). "letter" is the legacy word for a communication. Do NOT rename to `communications`.
- **No backend sender.** SMS/WhatsApp are `sms:`/`wa.me` deep links only. No Twilio/Meta API, no opt-in tracking, no delivery webhooks.
- **Recipients are `contact_id[]`, resolved live** — never denormalized snapshots.
- **Hebrew-first, RTL.** SMS/WhatsApp editors are `dir="rtl"`.
- **Phones stored as E.164** (`+9725XXXXXXXX`).
- **Gate before every push:** `npm test` && `npx tsc --noEmit` && `npm run lint` && `npm run build`. All must pass.
- **Solo-dev workflow:** work on `master`, commit per task, push after the gate passes.
- **Tests:** server tests live in `tests/server/` (node env, in-memory pglite — no real DB needed); component tests in `tests/components/` (happy-dom, `react-i18next` auto-mocked); pure logic in `tests/unit/`. Run one file with `npx vitest run <path>`.
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UPPKuAwc48W6D5uVucwx1A
  ```

## File Structure

**New files:**
- `src/lib/sms-segments.ts` — pure SMS encoding/segment math (Hebrew UCS-2 aware).
- `src/lib/phone.ts` — pure E.164 normalization + WhatsApp phone formatting.
- `server/repositories/letter-channels-repository.ts` — CRUD for `letter_channels` + contact-reference guard.
- `scripts/backfill-channels.ts` — one-off backfill of existing letters into email channels.
- `tests/unit/sms-segments.test.ts`, `tests/unit/phone.test.ts`, `tests/unit/letter-urls-deeplinks.test.ts`
- `tests/server/letter-channels-repository.test.ts`, `tests/server/backfill-channels.test.ts`, `tests/server/letter-contacts-widen.test.ts`, `tests/server/admin-letters-channels-route.test.ts`, `tests/server/letters-detail-channels.test.ts`, `tests/server/public-send-channels.test.ts`
- `src/components/letters/SmsBodyEditor.tsx` — RTL textarea + live segment counter.
- `tests/components/SmsBodyEditor.test.tsx`

**Modified files:**
- `src/lib/letter-urls.ts` — add `buildWhatsappUrl`, `buildSmsUrl`.
- `server/db/schema/letters.ts` — widen `letter_contacts`; add `letter_channels`.
- `server/db/migrations/` — generated expand + contract migrations (+ hand-patched CHECK/nullable).
- `src/types.ts` — `ChannelKind`, `LetterChannel(Input)`, widened `LetterContact`, reshaped `Letter` + `LetterDetailResponse`.
- `server/repositories/letter-contacts-repository.ts` — widen create/update/search; add `isReferenced`.
- `server/repositories/letters-repository.ts` — drop content fields from core input; add channel-aware read assembly.
- `server/routes/admin-letter-assets.ts` — contacts POST/PUT accept phone/photo/whatsapp/mk; DELETE guard.
- `server/routes/admin-letters.ts` — create/update accept `channels`.
- `server/routes/letters.ts` — `/contacts` widened + `?channel=` filter; detail resolves channels + builds links.
- `server/routes/public-letters.ts` — `/:id/send` accepts `channel` + `contactId`.
- `server/services/share-publisher.ts` — share-page HTML renders all channels.
- `src/lib/api-client.ts` — channel-aware create/update + widened contact methods.
- `src/pages/AdminLettersPage.tsx` — channel-tabbed composer + widened contact editor.
- `src/pages/LetterDetailPage.tsx` — render channels; per-recipient SMS/WhatsApp buttons.
- `src/locales/he.json`, `src/locales/en.json` — new strings.

---

## Phase 0 — Pure helpers (no DB, no network)

### Task 1: SMS segment analyzer

**Files:**
- Create: `src/lib/sms-segments.ts`
- Test: `tests/unit/sms-segments.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SmsEncoding = 'gsm7' | 'ucs2'
  export interface SmsSegmentInfo {
    encoding: SmsEncoding
    units: number       // billable units: extended GSM-7 chars count as 2
    segments: number
    perSegment: number  // unit capacity of each segment for THIS message
    remaining: number   // units left before the next segment boundary
  }
  export function analyzeSms(text: string): SmsSegmentInfo
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sms-segments.test.ts
import { describe, it, expect } from 'vitest'
import { analyzeSms } from '@/lib/sms-segments'

describe('analyzeSms', () => {
  it('empty string is one empty GSM-7 segment', () => {
    const r = analyzeSms('')
    expect(r).toMatchObject({ encoding: 'gsm7', units: 0, segments: 1, perSegment: 160, remaining: 160 })
  })

  it('plain ASCII uses GSM-7 at 160/segment', () => {
    expect(analyzeSms('a'.repeat(160))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 })
    expect(analyzeSms('a'.repeat(161))).toMatchObject({ encoding: 'gsm7', segments: 2, perSegment: 153 })
  })

  it('GSM-7 extended chars ({ } [ ] ~ | ^ \\ € ) count as two units', () => {
    // 80 '€' = 160 units = still one segment (boundary), 81 tips into two
    expect(analyzeSms('€'.repeat(80))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 })
    expect(analyzeSms('€'.repeat(81))).toMatchObject({ encoding: 'gsm7', units: 162, segments: 2 })
  })

  it('any Hebrew char forces UCS-2 at 70/segment (67 multipart)', () => {
    expect(analyzeSms('ש'.repeat(70))).toMatchObject({ encoding: 'ucs2', units: 70, segments: 1, perSegment: 70 })
    expect(analyzeSms('ש'.repeat(71))).toMatchObject({ encoding: 'ucs2', units: 71, segments: 2, perSegment: 67 })
  })

  it('mixed Hebrew + Latin still UCS-2 (one non-GSM char is enough)', () => {
    expect(analyzeSms('hello שלום').encoding).toBe('ucs2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sms-segments.test.ts`
Expected: FAIL — `analyzeSms` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/sms-segments.ts
export type SmsEncoding = 'gsm7' | 'ucs2'

export interface SmsSegmentInfo {
  encoding: SmsEncoding
  units: number
  segments: number
  perSegment: number
  remaining: number
}

// The GSM 03.38 basic character set (chars encodable in a single 7-bit unit).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
// Chars that ARE GSM-7 but occupy two 7-bit units (escape + char).
const GSM7_EXTENDED = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€'])

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (GSM7_EXTENDED.has(ch)) continue
    if (GSM7_BASIC.indexOf(ch) === -1) return false
  }
  return true
}

export function analyzeSms(text: string): SmsSegmentInfo {
  const gsm7 = isGsm7(text)
  const encoding: SmsEncoding = gsm7 ? 'gsm7' : 'ucs2'

  // Count billable units: GSM-7 extended chars are 2 units; everything else is 1.
  // UCS-2 counts by code points (astral chars would be 2 UTF-16 units, but our
  // content is Hebrew/Latin BMP — code-point count is correct here).
  let units = 0
  for (const ch of text) units += gsm7 && GSM7_EXTENDED.has(ch) ? 2 : 1

  const single = gsm7 ? 160 : 70
  const multi = gsm7 ? 153 : 67

  let segments: number
  let perSegment: number
  if (units <= single) {
    segments = units === 0 ? 1 : 1
    perSegment = single
  } else {
    segments = Math.ceil(units / multi)
    perSegment = multi
  }

  const capacity = segments * perSegment
  return { encoding, units, segments, perSegment, remaining: capacity - units }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sms-segments.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sms-segments.ts tests/unit/sms-segments.test.ts
git commit -m "feat(letters): Hebrew-aware SMS segment analyzer"
```

---

### Task 2: Phone normalization (E.164)

**Files:**
- Create: `src/lib/phone.ts`
- Test: `tests/unit/phone.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizePhone(raw: string): string | null   // → '+9725...' or null if unparseable
  export function phoneForWhatsapp(e164: string): string        // strips '+' and non-digits
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/phone.test.ts
import { describe, it, expect } from 'vitest'
import { normalizePhone, phoneForWhatsapp } from '@/lib/phone'

describe('normalizePhone', () => {
  it('Israeli local mobile 05X → +9725X', () => {
    expect(normalizePhone('052-123-4567')).toBe('+972521234567')
    expect(normalizePhone('0521234567')).toBe('+972521234567')
  })
  it('Israeli local landline 0X → +972X', () => {
    expect(normalizePhone('02-123-4567')).toBe('+97221234567')
  })
  it('already-international +972 / 972 preserved', () => {
    expect(normalizePhone('+972 52 123 4567')).toBe('+972521234567')
    expect(normalizePhone('972521234567')).toBe('+972521234567')
  })
  it('rejects garbage', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('phoneForWhatsapp', () => {
  it('strips the leading +', () => {
    expect(phoneForWhatsapp('+972521234567')).toBe('972521234567')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/phone.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/phone.ts
// Normalize to E.164, defaulting bare local numbers to Israel (+972). Deliberately
// narrow: this app's contacts are Israeli officials. A leading '+' (or '972') is
// treated as already-international; a leading '0' is an Israeli local number.
export function normalizePhone(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) return null

  let e164: string
  if (hasPlus) {
    e164 = `+${digits}`
  } else if (digits.startsWith('972')) {
    e164 = `+${digits}`
  } else if (digits.startsWith('0')) {
    e164 = `+972${digits.slice(1)}`
  } else {
    return null // ambiguous — no country context
  }

  // E.164 is up to 15 digits, and an Israeli number is at least +972 + 8 local digits.
  const body = e164.slice(1)
  if (body.length < 11 || body.length > 15) return null
  return e164
}

export function phoneForWhatsapp(e164: string): string {
  return e164.replace(/\D/g, '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/phone.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/phone.ts tests/unit/phone.test.ts
git commit -m "feat(letters): E.164 phone normalization helper"
```

---

### Task 3: SMS + WhatsApp deep-link builders

**Files:**
- Modify: `src/lib/letter-urls.ts` (append two functions)
- Test: `tests/unit/letter-urls-deeplinks.test.ts`

**Interfaces:**
- Consumes: `phoneForWhatsapp` from `src/lib/phone.ts` (Task 2).
- Produces:
  ```ts
  export function buildWhatsappUrl(phoneE164: string, text: string): string
  export function buildSmsUrl(phoneE164: string, text: string): string
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/letter-urls-deeplinks.test.ts
import { describe, it, expect } from 'vitest'
import { buildWhatsappUrl, buildSmsUrl } from '@/lib/letter-urls'

describe('buildWhatsappUrl', () => {
  it('uses wa.me with digits-only phone and encoded text', () => {
    expect(buildWhatsappUrl('+972521234567', 'שלום עולם')).toBe(
      'https://wa.me/972521234567?text=' + encodeURIComponent('שלום עולם'),
    )
  })
})

describe('buildSmsUrl', () => {
  it('uses the cross-platform sms:<phone>?&body= form with the + kept', () => {
    expect(buildSmsUrl('+972521234567', 'hi there')).toBe(
      'sms:+972521234567?&body=' + encodeURIComponent('hi there'),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/letter-urls-deeplinks.test.ts`
Expected: FAIL — `buildWhatsappUrl` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/letter-urls.ts`:

```ts
import { phoneForWhatsapp } from './phone'

/**
 * WhatsApp click-to-chat deep link. wa.me wants an international number with no
 * '+', spaces, or dashes. Opens the user's own WhatsApp with the text pre-filled;
 * no media parameter exists, so this carries text only.
 */
export function buildWhatsappUrl(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneForWhatsapp(phoneE164)}?text=${encodeURIComponent(text)}`
}

/**
 * SMS deep link. The `?&body=` form is deliberate cross-platform glue: iOS
 * historically wants `&body=`, Android `?body=`; `?&body=` is honored by both.
 * The '+' in the E.164 number is kept (dialers accept it).
 */
export function buildSmsUrl(phoneE164: string, text: string): string {
  return `sms:${phoneE164}?&body=${encodeURIComponent(text)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/letter-urls-deeplinks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/letter-urls.ts tests/unit/letter-urls-deeplinks.test.ts
git commit -m "feat(letters): wa.me + sms: deep-link builders"
```

---

## Phase 1 — Schema, repositories, backfill

### Task 4: Schema — widen contacts, add `letter_channels` (expand migration)

**Files:**
- Modify: `server/db/schema/letters.ts`
- Generate: `server/db/migrations/00NN_*.sql` (via `npm run db:generate`), then hand-patch.

**Interfaces:**
- Produces (Drizzle tables):
  - `letterContacts` gains `phone text`, `hasWhatsapp boolean default false`, `photoUrl text`, `mkSiteId integer`; `email` becomes nullable.
  - New `letterChannels` table with columns per the spec.

- [ ] **Step 1: Edit the schema**

In `server/db/schema/letters.ts`:

Replace the `letterContacts` table with:

```ts
export const letterContacts = lettersSchema.table('letter_contacts', {
  id: serial('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').unique(),                 // now nullable (many NULLs allowed under unique index)
  phone: text('phone'),                          // E.164
  hasWhatsapp: boolean('has_whatsapp').notNull().default(false),
  photoUrl: text('photo_url'),
  mkSiteId: integer('mk_site_id'),
  category: text('category').notNull().default('custom'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Add `boolean` to the `drizzle-orm/pg-core` import at the top of the file.

Add the channels table after `letters`:

```ts
export const letterChannels = lettersSchema.table('letter_channels', {
  id: serial('id').primaryKey(),
  letterId: integer('letter_id').notNull().references(() => letters.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),                  // 'email' | 'sms' | 'whatsapp'
  enabled: boolean('enabled').notNull().default(true),
  recipientIds: jsonb('recipient_ids').$type<number[]>().notNull().default([]),
  ccIds: jsonb('cc_ids').$type<number[]>().notNull().default([]),
  bccIds: jsonb('bcc_ids').$type<number[]>().notNull().default([]),
  bodyText: text('body_text').notNull().default(''),
  subject: text('subject'),                      // email-only
  bodyHtml: text('body_html'),                   // email-only
  templateId: integer('template_id').references(() => letterTemplates.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqLetterKind: unique().on(t.letterId, t.kind),
}))
```

Add `unique` to the `drizzle-orm/pg-core` import.

**Do NOT remove** the old `letters` content columns yet (expand phase keeps them).

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `server/db/migrations/00NN_*.sql` creating `letter_channels`, adding the four `letter_contacts` columns, and dropping the `email` NOT NULL.

- [ ] **Step 3: Hand-patch the generated SQL**

Open the generated file. Append these statements (Drizzle does not emit CHECK constraints or the old-column relaxations reliably):

```sql
-- Relax the legacy letters content columns so new inserts (which write channels
-- instead) don't trip NOT NULL during the transition window.
ALTER TABLE "letters"."letters" ALTER COLUMN "subject" DROP NOT NULL;
ALTER TABLE "letters"."letters" ALTER COLUMN "body_html" DROP NOT NULL;
ALTER TABLE "letters"."letters" ALTER COLUMN "body_plain" DROP NOT NULL;

-- A contact must be reachable by at least one channel.
ALTER TABLE "letters"."letter_contacts"
  ADD CONSTRAINT "letter_contacts_email_or_phone"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

-- Email channels must carry a subject + HTML body.
ALTER TABLE "letters"."letter_channels"
  ADD CONSTRAINT "letter_channels_email_content"
  CHECK ("kind" <> 'email' OR ("subject" IS NOT NULL AND "body_html" IS NOT NULL));
```

Confirm the schema names: the tables live under the `letters` Postgres schema (`lettersSchema`); verify the generated file's identifiers match (`"letters"."letter_contacts"` etc.) and adjust if Drizzle emitted a different qualifier.

- [ ] **Step 4: Verify it applies (migrations auto-apply on boot; use a scratch DB)**

Run:
```bash
npm run db:reset   # wipes + starts fresh local Postgres, applies all migrations on boot via the server, OR:
npx tsx server/db/migrate.ts   # if a standalone migrate entry exists; otherwise start the server once
```
Expected: no migration error; `\d letters.letter_channels` shows the table.

If you don't want a live DB, rely on the pglite-backed server test in Task 6 to exercise the schema.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/letters.ts server/db/migrations/
git commit -m "feat(letters): expand schema — widen contacts, add letter_channels"
```

---

### Task 5: `LetterChannelsRepository`

**Files:**
- Create: `server/repositories/letter-channels-repository.ts`
- Test: `tests/server/letter-channels-repository.test.ts`

**Interfaces:**
- Consumes: `letterChannels` from `server/db/schema`.
- Produces:
  ```ts
  export type LetterChannelRow = typeof letterChannels.$inferSelect
  export interface LetterChannelInput {
    kind: 'email' | 'sms' | 'whatsapp'
    enabled?: boolean
    recipientIds: number[]
    ccIds?: number[]
    bccIds?: number[]
    bodyText: string
    subject?: string | null
    bodyHtml?: string | null
    templateId?: number | null
  }
  class LetterChannelsRepository {
    listByLetter(letterId: number): Promise<LetterChannelRow[]>
    listByLetterIds(letterIds: number[]): Promise<Map<number, LetterChannelRow[]>>
    replaceForLetter(letterId: number, channels: LetterChannelInput[]): Promise<void>
    contactReferenced(contactId: number): Promise<boolean>
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/letter-channels-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letters, letterChannels } from '../../server/db/schema'
import { LetterChannelsRepository } from '../../server/repositories/letter-channels-repository'

const repo = new LetterChannelsRepository()

async function newLetter(): Promise<number> {
  const [row] = await db.insert(letters).values({ title: 'T', status: 'draft', priority: 'normal' }).returning()
  return row.id
}

describe('LetterChannelsRepository', () => {
  beforeEach(async () => {
    await db.delete(letterChannels)
    await db.delete(letters)
  })

  it('replaceForLetter inserts channels and is idempotent (full replace)', async () => {
    const id = await newLetter()
    await repo.replaceForLetter(id, [
      { kind: 'email', recipientIds: [1], ccIds: [2], bodyText: 'plain', subject: 'S', bodyHtml: '<p>x</p>' },
      { kind: 'sms', recipientIds: [1, 3], bodyText: 'קצר' },
    ])
    expect((await repo.listByLetter(id)).map((c) => c.kind).sort()).toEqual(['email', 'sms'])

    await repo.replaceForLetter(id, [{ kind: 'whatsapp', recipientIds: [4], bodyText: 'hi' }])
    const after = await repo.listByLetter(id)
    expect(after.map((c) => c.kind)).toEqual(['whatsapp'])
  })

  it('contactReferenced finds a contact used in any recipient list', async () => {
    const id = await newLetter()
    await repo.replaceForLetter(id, [{ kind: 'sms', recipientIds: [7], bodyText: 'x' }])
    expect(await repo.contactReferenced(7)).toBe(true)
    expect(await repo.contactReferenced(99)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/letter-channels-repository.test.ts`
Expected: FAIL — repository module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/repositories/letter-channels-repository.ts
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { letterChannels } from '../db/schema'

export type LetterChannelRow = typeof letterChannels.$inferSelect

export interface LetterChannelInput {
  kind: 'email' | 'sms' | 'whatsapp'
  enabled?: boolean
  recipientIds: number[]
  ccIds?: number[]
  bccIds?: number[]
  bodyText: string
  subject?: string | null
  bodyHtml?: string | null
  templateId?: number | null
}

export class LetterChannelsRepository {
  async listByLetter(letterId: number): Promise<LetterChannelRow[]> {
    return db.select().from(letterChannels).where(eq(letterChannels.letterId, letterId)).orderBy(letterChannels.kind)
  }

  async listByLetterIds(letterIds: number[]): Promise<Map<number, LetterChannelRow[]>> {
    const map = new Map<number, LetterChannelRow[]>()
    if (letterIds.length === 0) return map
    const rows = await db.select().from(letterChannels).where(inArray(letterChannels.letterId, letterIds))
    for (const r of rows) {
      const list = map.get(r.letterId) ?? []
      list.push(r)
      map.set(r.letterId, list)
    }
    return map
  }

  /** Full replace: delete existing channels for the letter, insert the new set, in one transaction. */
  async replaceForLetter(letterId: number, channels: LetterChannelInput[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(letterChannels).where(eq(letterChannels.letterId, letterId))
      if (channels.length === 0) return
      const now = new Date()
      await tx.insert(letterChannels).values(
        channels.map((c) => ({
          letterId,
          kind: c.kind,
          enabled: c.enabled ?? true,
          recipientIds: c.recipientIds ?? [],
          ccIds: c.ccIds ?? [],
          bccIds: c.bccIds ?? [],
          bodyText: c.bodyText ?? '',
          subject: c.subject ?? null,
          bodyHtml: c.bodyHtml ?? null,
          templateId: c.templateId ?? null,
          createdAt: now,
          updatedAt: now,
        })),
      )
    })
  }

  /** True if the contact id appears in any channel's recipient/cc/bcc arrays. */
  async contactReferenced(contactId: number): Promise<boolean> {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(letterChannels)
      .where(sql`
        ${letterChannels.recipientIds} @> ${JSON.stringify([contactId])}::jsonb OR
        ${letterChannels.ccIds}       @> ${JSON.stringify([contactId])}::jsonb OR
        ${letterChannels.bccIds}      @> ${JSON.stringify([contactId])}::jsonb
      `)
    return Number(row?.n ?? 0) > 0
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/letter-channels-repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/letter-channels-repository.ts tests/server/letter-channels-repository.test.ts
git commit -m "feat(letters): LetterChannelsRepository (CRUD + reference guard)"
```

---

### Task 6: Widen `LetterContactsRepository`

**Files:**
- Modify: `server/repositories/letter-contacts-repository.ts`
- Test: `tests/server/letter-contacts-widen.test.ts`

**Interfaces:**
- Consumes: `LetterChannelsRepository.contactReferenced` (Task 5).
- Produces:
  ```ts
  interface ContactInput {
    displayName: string
    email?: string | null
    phone?: string | null
    hasWhatsapp?: boolean
    photoUrl?: string | null
    mkSiteId?: number | null
    category?: string
  }
  // create(input): Promise<LetterContact>
  // update(id, input): Promise<void>
  // isReferenced(id): Promise<boolean>
  // search(q) also matches phone
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/letter-contacts-widen.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letterContacts, letterChannels, letters } from '../../server/db/schema'
import { LetterContactsRepository } from '../../server/repositories/letter-contacts-repository'

const repo = new LetterContactsRepository()

describe('LetterContactsRepository (widened)', () => {
  beforeEach(async () => {
    await db.delete(letterChannels)
    await db.delete(letters)
    await db.delete(letterContacts)
  })

  it('creates a phone-only contact (no email)', async () => {
    const c = await repo.create({ displayName: 'MK Phone', phone: '+972521234567' })
    expect(c.email).toBeNull()
    expect(c.phone).toBe('+972521234567')
    expect(c.hasWhatsapp).toBe(false)
  })

  it('persists photoUrl + mkSiteId + hasWhatsapp on update', async () => {
    const c = await repo.create({ displayName: 'X', email: 'x@e.com' })
    await repo.update(c.id, { displayName: 'X', email: 'x@e.com', photoUrl: 'https://p/x.jpg', mkSiteId: 1116, hasWhatsapp: true })
    const [row] = await repo.search('X')
    expect(row).toMatchObject({ photoUrl: 'https://p/x.jpg', mkSiteId: 1116, hasWhatsapp: true })
  })

  it('isReferenced reflects channel membership', async () => {
    const c = await repo.create({ displayName: 'Ref', email: 'r@e.com' })
    expect(await repo.isReferenced(c.id)).toBe(false)
    const [l] = await db.insert(letters).values({ title: 'T', status: 'draft', priority: 'normal' }).returning()
    await db.insert(letterChannels).values({ letterId: l.id, kind: 'email', recipientIds: [c.id], subject: 'S', bodyHtml: '<p>x</p>' })
    expect(await repo.isReferenced(c.id)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/letter-contacts-widen.test.ts`
Expected: FAIL — `create` rejects extra fields / `isReferenced` undefined.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `server/repositories/letter-contacts-repository.ts`:

```ts
import { eq, ilike, or } from 'drizzle-orm'
import { db } from '../db/client'
import { letterContacts } from '../db/schema'
import { LetterChannelsRepository } from './letter-channels-repository'

export type LetterContact = typeof letterContacts.$inferSelect

export interface ContactInput {
  displayName: string
  email?: string | null
  phone?: string | null
  hasWhatsapp?: boolean
  photoUrl?: string | null
  mkSiteId?: number | null
  category?: string
}

const channelsRepo = new LetterChannelsRepository()

function values(input: ContactInput) {
  return {
    displayName: input.displayName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    hasWhatsapp: input.hasWhatsapp ?? false,
    photoUrl: input.photoUrl ?? null,
    mkSiteId: input.mkSiteId ?? null,
    category: input.category ?? 'custom',
  }
}

export class LetterContactsRepository {
  async list(): Promise<LetterContact[]> {
    return db.select().from(letterContacts).orderBy(letterContacts.displayName)
  }

  async search(q: string): Promise<LetterContact[]> {
    const pattern = `%${q}%`
    return db
      .select()
      .from(letterContacts)
      .where(or(
        ilike(letterContacts.displayName, pattern),
        ilike(letterContacts.email, pattern),
        ilike(letterContacts.phone, pattern),
      ))
      .orderBy(letterContacts.displayName)
  }

  async create(input: ContactInput): Promise<LetterContact> {
    const [row] = await db.insert(letterContacts).values(values(input)).returning()
    return row
  }

  async bulkUpsert(rows: ContactInput[]): Promise<void> {
    if (rows.length === 0) return
    await db.insert(letterContacts).values(rows.map(values)).onConflictDoNothing({ target: letterContacts.email })
  }

  async update(id: number, input: ContactInput): Promise<void> {
    await db.update(letterContacts).set(values(input)).where(eq(letterContacts.id, id))
  }

  async isReferenced(id: number): Promise<boolean> {
    return channelsRepo.contactReferenced(id)
  }

  async delete(id: number): Promise<void> {
    await db.delete(letterContacts).where(eq(letterContacts.id, id))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/letter-contacts-widen.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/repositories/letter-contacts-repository.ts tests/server/letter-contacts-widen.test.ts
git commit -m "feat(letters): widen contacts repo (phone, photo, mk, reference guard)"
```

---

### Task 7: Backfill existing letters into email channels

**Files:**
- Create: `scripts/backfill-channels.ts`
- Modify: `package.json` (add `db:backfill-channels` script)
- Test: `tests/server/backfill-channels.test.ts`

**Interfaces:**
- Consumes: `LettersRepository` rows (with legacy content columns still present), `LetterContactsRepository.create`, `LetterChannelsRepository.replaceForLetter`.
- Produces: `export async function backfillChannels(): Promise<{ migrated: number }>` — for each letter with no channels, find-or-create a contact per legacy To/Cc/Bcc address (by email) and insert one `email` channel. Idempotent.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/backfill-channels.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letters, letterChannels, letterContacts } from '../../server/db/schema'
import { backfillChannels } from '../../scripts/backfill-channels'

describe('backfillChannels', () => {
  beforeEach(async () => {
    await db.delete(letterChannels)
    await db.delete(letters)
    await db.delete(letterContacts)
  })

  it('creates one email channel per legacy letter, find-or-creating contacts, idempotently', async () => {
    await db.insert(letters).values({
      title: 'Legacy', status: 'published', priority: 'normal',
      subject: 'S', bodyHtml: '<p>hi</p>', bodyPlain: 'hi',
      toAddresses: [{ email: 'mk@knesset.gov.il', display_name: 'MK' }],
      ccAddresses: [], bccAddresses: [],
    })

    const first = await backfillChannels()
    expect(first.migrated).toBe(1)

    const chans = await db.select().from(letterChannels)
    expect(chans).toHaveLength(1)
    expect(chans[0].kind).toBe('email')
    const contacts = await db.select().from(letterContacts)
    expect(contacts).toHaveLength(1)
    expect(chans[0].recipientIds).toEqual([contacts[0].id])

    // Re-run: no new channels, no new contacts.
    const second = await backfillChannels()
    expect(second.migrated).toBe(0)
    expect(await db.select().from(letterChannels)).toHaveLength(1)
    expect(await db.select().from(letterContacts)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/backfill-channels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/backfill-channels.ts
import { eq } from 'drizzle-orm'
import { db } from '../server/db/client'
import { letters, letterChannels, letterContacts } from '../server/db/schema'
import type { LetterAddress } from '../server/db/schema'

/** Find-or-create a contact by email; returns its id. Emails are unique. */
async function contactIdForAddress(addr: LetterAddress): Promise<number> {
  const [existing] = await db.select().from(letterContacts).where(eq(letterContacts.email, addr.email))
  if (existing) return existing.id
  const [created] = await db
    .insert(letterContacts)
    .values({ displayName: addr.display_name || addr.email, email: addr.email, category: 'custom' })
    .returning()
  return created.id
}

async function idsFor(addrs: LetterAddress[]): Promise<number[]> {
  const ids: number[] = []
  for (const a of addrs) ids.push(await contactIdForAddress(a))
  return ids
}

export async function backfillChannels(): Promise<{ migrated: number }> {
  const all = await db.select().from(letters)
  let migrated = 0
  for (const l of all) {
    const [hasChannel] = await db.select().from(letterChannels).where(eq(letterChannels.letterId, l.id)).limit(1)
    if (hasChannel) continue // idempotent
    const recipientIds = await idsFor((l.toAddresses ?? []) as LetterAddress[])
    const ccIds = await idsFor((l.ccAddresses ?? []) as LetterAddress[])
    const bccIds = await idsFor((l.bccAddresses ?? []) as LetterAddress[])
    await db.insert(letterChannels).values({
      letterId: l.id,
      kind: 'email',
      enabled: true,
      recipientIds, ccIds, bccIds,
      bodyText: l.bodyPlain ?? '',
      subject: l.subject ?? '',
      bodyHtml: l.bodyHtml ?? '',
      templateId: l.templateId ?? null,
    })
    migrated++
  }
  return { migrated }
}

// Allow `tsx scripts/backfill-channels.ts` to run it directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillChannels()
    .then((r) => { console.log(`[backfill] migrated ${r.migrated} letters`); process.exit(0) })
    .catch((e) => { console.error('[backfill] failed:', e); process.exit(1) })
}
```

Add to `package.json` scripts:
```json
"db:backfill-channels": "tsx scripts/backfill-channels.ts",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/backfill-channels.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-channels.ts tests/server/backfill-channels.test.ts package.json
git commit -m "feat(letters): idempotent backfill of legacy letters into email channels"
```

---

## Phase 2 — Shared types + API

### Task 8: Shared types

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces the shapes every later task imports. Keep exact names.

- [ ] **Step 1: Edit `src/types.ts`**

Replace `LetterContact` and `Letter` and `LetterDetailResponse`; add channel types:

```ts
export type ChannelKind = 'email' | 'sms' | 'whatsapp'

export interface LetterChannel {
  id: number
  letterId: number
  kind: ChannelKind
  enabled: boolean
  recipientIds: number[]
  ccIds: number[]
  bccIds: number[]
  bodyText: string
  subject: string | null
  bodyHtml: string | null
  templateId: number | null
}

export interface LetterChannelInput {
  kind: ChannelKind
  enabled?: boolean
  recipientIds: number[]
  ccIds?: number[]
  bccIds?: number[]
  bodyText: string
  subject?: string | null
  bodyHtml?: string | null
  templateId?: number | null
}

export interface LetterContact {
  id: number
  displayName: string
  email: string | null
  phone: string | null
  hasWhatsapp: boolean
  photoUrl: string | null
  mkSiteId: number | null
  category: string
  createdAt: string
}

export interface Letter {
  id: number
  title: string
  channels: LetterChannel[]
  issueTagIds: number[]
  status: 'draft' | 'published'
  priority: 'normal' | 'high' | 'urgent'
  pinnedAt: string | null
  activityScore: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RecipientSendLink {
  contactId: number
  displayName: string
  photoUrl: string | null
  url: string
}

export interface ChannelSend {
  kind: ChannelKind
  enabled: boolean
  bodyText: string
  unavailableCount: number
  // email only:
  mailtoUrl?: string
  gmailUrl?: string
  renderedHtml?: string
  // sms / whatsapp only:
  recipients?: RecipientSendLink[]
}

export interface LetterDetailResponse {
  letter: Letter
  channels: ChannelSend[]
}
```

Delete the now-unused `LetterAddress` interface ONLY after Task 12 (the migration/backfill still imports the schema-side `LetterAddress` type, which is separate). Leave `LetterAddress` in place for now.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in consumers (`AdminLettersPage`, `LetterDetailPage`, repos) — that's expected; later tasks fix them. Confirm the errors are only about the removed `Letter.subject`/`toAddresses`/etc., proving the shape changed. Do not fix consumers here.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(letters): channel-aware shared types"
```

---

### Task 9: Admin letters create/update accept `channels`

**Files:**
- Modify: `server/repositories/letters-repository.ts` (drop content fields from `LetterInput`; add channel assembly helpers)
- Modify: `server/routes/admin-letters.ts` (accept `channels`, call channels repo)
- Test: `tests/server/admin-letters-channels-route.test.ts`

**Interfaces:**
- Consumes: `LetterChannelsRepository.replaceForLetter` (Task 5).
- Produces: `LettersRepository.createCore(input)` / `updateCore(id, input)` where input is the shared fields only (`title`, `issueTagIds`, `status`, `priority`, `pinnedAt`, `createdBy`); and `attachChannels(rows)` returning `Letter[]` with `channels` populated.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/admin-letters-channels-route.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../server/app'            // follow the existing route tests' app import
import { db } from '../../server/db/client'
import { letters, letterChannels } from '../../server/db/schema'
import { makeAdminToken } from './helpers/auth'    // reuse the existing admin-token helper used by other admin route tests

describe('POST /api/admin/letters with channels', () => {
  beforeEach(async () => { await db.delete(letterChannels); await db.delete(letters) })

  it('creates a letter with email + sms channels', async () => {
    const token = await makeAdminToken()
    const res = await request(app)
      .post('/api/admin/letters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Housing reform', status: 'draft', priority: 'high', issueTagIds: [],
        channels: [
          { kind: 'email', recipientIds: [1], bodyText: 'plain', subject: 'S', bodyHtml: '<p>x</p>' },
          { kind: 'sms', recipientIds: [1], bodyText: 'קצר' },
        ],
      })
    expect(res.status).toBe(201)
    const chans = await db.select().from(letterChannels)
    expect(chans.map((c) => c.kind).sort()).toEqual(['email', 'sms'])
  })
})
```

> If the existing admin-letters route tests use a different bootstrap (e.g. a `buildApp()` factory or an inline token helper), mirror that exact pattern instead of the imports above — check `tests/server/admin-letters-share-hook.test.ts` for the established shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-letters-channels-route.test.ts`
Expected: FAIL — route ignores `channels` / no channel rows created.

- [ ] **Step 3: Implement**

In `server/repositories/letters-repository.ts`:
- Change `LetterInput` to the shared-only fields:
  ```ts
  export type LetterCoreInput = {
    title: string
    issueTagIds?: number[]
    status?: string
    priority?: string
    pinnedAt?: Date | null
    pinNotifiedAt?: Date | null
    createdBy?: number | null
  }
  ```
- Rename `create` → `createCore` and `update` → `updateCore`, dropping all `subject/bodyHtml/bodyPlain/toAddresses/ccAddresses/bccAddresses/templateId` writes (keep the `publishedAt` stamping logic).
- Add channel assembly:
  ```ts
  import { LetterChannelsRepository } from './letter-channels-repository'
  import type { Letter as LetterApi, LetterChannel } from '../../src/types'
  const channelsRepo = new LetterChannelsRepository()

  function toApiChannel(r: typeof letterChannels.$inferSelect): LetterChannel {
    return {
      id: r.id, letterId: r.letterId, kind: r.kind as LetterChannel['kind'],
      enabled: r.enabled, recipientIds: r.recipientIds, ccIds: r.ccIds, bccIds: r.bccIds,
      bodyText: r.bodyText, subject: r.subject, bodyHtml: r.bodyHtml, templateId: r.templateId,
    }
  }
  export async function attachChannels(rows: Letter[]): Promise<LetterApi[]> {
    const byLetter = await channelsRepo.listByLetterIds(rows.map((r) => r.id))
    return rows.map((r) => ({
      id: r.id, title: r.title, issueTagIds: r.issueTagIds,
      status: r.status as LetterApi['status'], priority: r.priority as LetterApi['priority'],
      pinnedAt: r.pinnedAt?.toISOString() ?? null, activityScore: r.activityScore,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      channels: (byLetter.get(r.id) ?? []).map(toApiChannel),
    }))
  }
  ```
  (Add `letterChannels` to the schema import.)

In `server/routes/admin-letters.ts`, the create handler:
```ts
const { title, status, priority, issueTagIds, channels } = req.body
const letter = await lettersRepo.createCore({ title, status, priority, issueTagIds, createdBy: req.user?.id ?? null })
await channelsRepo.replaceForLetter(letter.id, channels ?? [])
// keep the existing share-page sync trigger (setImmediate(syncShareForLetter, letter.id))
res.status(201).json({ letter: (await attachChannels([letter]))[0] })
```
The update handler: `await lettersRepo.updateCore(id, core)` then `if (channels) await channelsRepo.replaceForLetter(id, channels)`.

Update all other call sites of the old `lettersRepo.create/update` (the poller does not touch letters; search `lettersRepo.create(`/`.update(` and switch to `createCore`/`updateCore`). The admin list/detail routes that read letters must wrap rows in `attachChannels(...)` — do that in Tasks 10–11.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/admin-letters-channels-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/repositories/letters-repository.ts server/routes/admin-letters.ts tests/server/admin-letters-channels-route.test.ts
git commit -m "feat(letters): admin create/update accept channels"
```

---

### Task 10: `GET /api/letters/contacts` widened + `?channel=` filter; admin list returns channels

**Files:**
- Modify: `server/routes/letters.ts` (contacts endpoint: return widened fields; `?channel=` filter)
- Modify: `server/routes/admin-letters.ts` (list wraps rows in `attachChannels`)
- Test: extend `tests/server/letter-contacts-widen.test.ts` or add `tests/server/letters-contacts-filter.test.ts`

**Interfaces:**
- Consumes: `LetterContactsRepository`, availability rule (email ⟺ email present; sms ⟺ phone present; whatsapp ⟺ phone present AND hasWhatsapp).
- Produces: contacts list filtered to those reachable on `?channel=`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/letters-contacts-filter.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../server/app'
import { db } from '../../server/db/client'
import { letterContacts } from '../../server/db/schema'

describe('GET /api/letters/contacts?channel=', () => {
  beforeEach(async () => {
    await db.delete(letterContacts)
    await db.insert(letterContacts).values([
      { displayName: 'Email only', email: 'e@x.com' },
      { displayName: 'SMS only', phone: '+972520000001', hasWhatsapp: false },
      { displayName: 'WA', phone: '+972520000002', hasWhatsapp: true },
    ])
  })
  it('channel=whatsapp returns only phone+hasWhatsapp contacts', async () => {
    const res = await request(app).get('/api/letters/contacts?channel=whatsapp')
      // add the auth header the endpoint requires — mirror the other letters route tests
    expect(res.status).toBe(200)
    expect(res.body.contacts.map((c: { displayName: string }) => c.displayName)).toEqual(['WA'])
  })
})
```

> Match the endpoint's real auth: per CLAUDE.md `/api/letters/contacts` is `requireAuth + lettersEnabled`. Reuse whatever token/flag setup the existing letters route tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/letters-contacts-filter.test.ts`
Expected: FAIL — filter not implemented.

- [ ] **Step 3: Implement**

Add an availability helper (new file `server/services/channel-availability.ts`, reused by Task 11):
```ts
import type { ChannelKind } from '../../src/types'
type ContactLike = { email: string | null; phone: string | null; hasWhatsapp: boolean }
export function reachableOn(kind: ChannelKind, c: ContactLike): boolean {
  if (kind === 'email') return !!c.email
  if (kind === 'sms') return !!c.phone
  return !!c.phone && c.hasWhatsapp // whatsapp
}
```

In `server/routes/letters.ts` `/contacts` handler:
```ts
const channel = req.query.channel as ChannelKind | undefined
let contacts = q ? await contactsRepo.search(q) : await contactsRepo.list()
if (channel) contacts = contacts.filter((c) => reachableOn(channel, c))
res.json({ contacts })
```

In `server/routes/admin-letters.ts` list handler, wrap rows: `res.json({ letters: await attachChannels(rows) })` and compute `LetterWithStats` by merging analytics as before (keep the existing stats join; just add `channels`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/letters-contacts-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/letters.ts server/routes/admin-letters.ts server/services/channel-availability.ts tests/server/letters-contacts-filter.test.ts
git commit -m "feat(letters): contact channel-availability filter + channels in admin list"
```

---

### Task 11: Letter detail resolves channels → send links

**Files:**
- Modify: `server/routes/letters.ts` (detail handler) and the public detail path (share data)
- Create: `server/services/channel-send.ts` — builds `ChannelSend[]` from a letter's channels + resolved contacts
- Test: `tests/server/letters-detail-channels.test.ts`

**Interfaces:**
- Consumes: `buildMailtoUrl`, `buildGmailComposeUrl`, `buildWhatsappUrl`, `buildSmsUrl` (via `server/services/letter-utils.ts` re-export), `reachableOn` (Task 10), `LetterContactsRepository`.
- Produces: `export async function buildChannelSends(channels: LetterChannel[]): Promise<ChannelSend[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/letters-detail-channels.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../server/db/client'
import { letterContacts } from '../../server/db/schema'
import { buildChannelSends } from '../../server/services/channel-send'

describe('buildChannelSends', () => {
  let email = 0, sms = 0
  beforeEach(async () => {
    await db.delete(letterContacts)
    const [a] = await db.insert(letterContacts).values({ displayName: 'Has both', email: 'a@x.com', phone: '+972520000001', hasWhatsapp: true }).returning()
    const [b] = await db.insert(letterContacts).values({ displayName: 'No phone', email: 'b@x.com' }).returning()
    email = a.id; sms = b.id
  })

  it('email → single mailto/gmail; sms → per-recipient links, skipping unreachable', async () => {
    const sends = await buildChannelSends([
      { id: 1, letterId: 1, kind: 'email', enabled: true, recipientIds: [email, sms], ccIds: [], bccIds: [], bodyText: 'hi', subject: 'S', bodyHtml: '<p>h</p>', templateId: null },
      { id: 2, letterId: 1, kind: 'sms', enabled: true, recipientIds: [email, sms], ccIds: [], bccIds: [], bodyText: 'קצר', subject: null, bodyHtml: null, templateId: null },
    ])
    const em = sends.find((s) => s.kind === 'email')!
    expect(em.mailtoUrl).toContain('mailto:')
    expect(em.gmailUrl).toContain('mail.google.com')

    const s = sends.find((s) => s.kind === 'sms')!
    expect(s.recipients!.map((r) => r.displayName)).toEqual(['Has both']) // 'No phone' skipped
    expect(s.recipients![0].url).toContain('sms:+972520000001')
    expect(s.unavailableCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/letters-detail-channels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// server/services/channel-send.ts
import { inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { letterContacts } from '../db/schema'
import type { ChannelSend, LetterChannel, RecipientSendLink } from '../../src/types'
import { reachableOn } from './channel-availability'
import { buildMailtoUrl, buildGmailComposeUrl, buildWhatsappUrl, buildSmsUrl } from './letter-utils'

export async function buildChannelSends(channels: LetterChannel[]): Promise<ChannelSend[]> {
  const ids = [...new Set(channels.flatMap((c) => [...c.recipientIds, ...c.ccIds, ...c.bccIds]))]
  const contacts = ids.length ? await db.select().from(letterContacts).where(inArray(letterContacts.id, ids)) : []
  const byId = new Map(contacts.map((c) => [c.id, c]))

  return channels.map((ch): ChannelSend => {
    if (ch.kind === 'email') {
      const resolve = (list: number[]) =>
        list.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && reachableOn('email', c))
          .map((c) => ({ email: c.email!, display_name: c.displayName, contact_id: c.id }))
      const to = resolve(ch.recipientIds), cc = resolve(ch.ccIds), bcc = resolve(ch.bccIds)
      const unavailable = ch.recipientIds.length - to.length
      return {
        kind: 'email', enabled: ch.enabled, bodyText: ch.bodyText, unavailableCount: unavailable,
        mailtoUrl: buildMailtoUrl(to, cc, bcc, ch.subject ?? '', ch.bodyText),
        gmailUrl: buildGmailComposeUrl(to, cc, bcc, ch.subject ?? '', ch.bodyText),
        renderedHtml: ch.bodyHtml ?? '',
      }
    }
    // sms / whatsapp: one link per reachable recipient
    const recipients: RecipientSendLink[] = []
    let unavailable = 0
    for (const id of ch.recipientIds) {
      const c = byId.get(id)
      if (!c || !reachableOn(ch.kind, c)) { unavailable++; continue }
      recipients.push({
        contactId: c.id, displayName: c.displayName, photoUrl: c.photoUrl,
        url: ch.kind === 'whatsapp' ? buildWhatsappUrl(c.phone!, ch.bodyText) : buildSmsUrl(c.phone!, ch.bodyText),
      })
    }
    return { kind: ch.kind, enabled: ch.enabled, bodyText: ch.bodyText, unavailableCount: unavailable, recipients }
  })
}
```

Re-export the deep-link builders from `server/services/letter-utils.ts` (it already re-exports the mailto/gmail builders): add `buildWhatsappUrl`, `buildSmsUrl` to its re-export list.

In `server/routes/letters.ts` detail handler: assemble the `Letter` via `attachChannels`, then `channels: await buildChannelSends(letter.channels)`, returning `{ letter, channels }` per the new `LetterDetailResponse`. Remove the old top-level `mailtoUrl`/`gmailUrl`/`renderedHtml`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/letters-detail-channels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/channel-send.ts server/services/letter-utils.ts server/routes/letters.ts tests/server/letters-detail-channels.test.ts
git commit -m "feat(letters): resolve channels into per-recipient send links"
```

---

### Task 12: Public send analytics + contact deletion guard

**Files:**
- Modify: `server/routes/public-letters.ts` (`/:id/send` accepts `channel` + `contactId`)
- Modify: `server/routes/admin-letter-assets.ts` (contacts POST/PUT normalize phone + validate; DELETE guard)
- Test: `tests/server/public-send-channels.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` (Task 2), `LetterContactsRepository.isReferenced` (Task 6), `LetterAnalyticsRepository` (existing).
- Produces: analytics buckets `public_sms`/`public_whatsapp` (in addition to existing `public_mailto`/`public_gmail`/`public_copy`), with `contactId` counted in the bucket `breakdown`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/public-send-channels.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../../server/app'
import { db } from '../../server/db/client'
import { letters, letterChannels, letterAnalytics } from '../../server/db/schema'

describe('POST /api/public/letters/:id/send (channels)', () => {
  let id = 0
  beforeEach(async () => {
    await db.delete(letterAnalytics); await db.delete(letterChannels); await db.delete(letters)
    const [l] = await db.insert(letters).values({ title: 'T', status: 'published', priority: 'normal', publishedAt: new Date() }).returning()
    id = l.id
    await db.insert(letterChannels).values({ letterId: id, kind: 'sms', recipientIds: [5], bodyText: 'x' })
  })

  it('records a public_sms send with the contact in the breakdown', async () => {
    const res = await request(app).post(`/api/public/letters/${id}/send`).send({ channel: 'sms', contactId: 5 })
    expect(res.status).toBe(200)
    const [row] = await db.select().from(letterAnalytics).where(/* letterId=id AND bucket='public_sms' — use eq/and */ undefined as never)
    // Assert via a direct query in the real test; pseudo shown for brevity:
    const all = await db.select().from(letterAnalytics)
    const sms = all.find((r) => r.bucket === 'public_sms')!
    expect(sms.total).toBe(1)
    expect(sms.breakdown).toMatchObject({ '5': 1 })
  })
})
```
(Write the real `eq/and` query; the pseudo-comment is only illustrative.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/public-send-channels.test.ts`
Expected: FAIL — `channel` ignored / bucket not written.

- [ ] **Step 3: Implement**

In `server/routes/public-letters.ts` `/:id/send`:
```ts
const { channel, contactId } = req.body as { channel?: string; contactId?: number }
const bucketMap: Record<string, string> = {
  mailto: 'public_mailto', gmail: 'public_gmail', copy: 'public_copy',
  sms: 'public_sms', whatsapp: 'public_whatsapp',
}
const bucket = bucketMap[channel ?? 'mailto'] ?? 'public_mailto'
await analyticsRepo.increment(id, bucket, contactId != null ? String(contactId) : undefined)
```
Ensure `LetterAnalyticsRepository.increment(letterId, bucket, breakdownKey?)` bumps `total` and, when `breakdownKey` is given, `breakdown[key]` (extend the existing increment to take an optional key if it doesn't already). Keep the existing Turnstile gate + `lettersEnabled` + published checks unchanged.

In `server/routes/admin-letter-assets.ts`:
- POST/PUT `/contacts`: accept `phone`, `hasWhatsapp`, `photoUrl`, `mkSiteId`; require `displayName` and at least one of email/phone; normalize phone:
  ```ts
  const { displayName, email, phone, hasWhatsapp, photoUrl, mkSiteId, category } = req.body
  if (!displayName || (!email && !phone)) return res.status(400).json({ error: 'displayName and email or phone required' })
  let e164: string | null = null
  if (phone) { e164 = normalizePhone(phone); if (!e164) return res.status(400).json({ error: 'invalid phone' }) }
  const contact = await contactsRepo.create({ displayName, email: email ?? null, phone: e164, hasWhatsapp: !!hasWhatsapp, photoUrl: photoUrl ?? null, mkSiteId: mkSiteId ?? null, category })
  ```
  (Import `normalizePhone` from `../../src/lib/phone`.)
- DELETE `/contacts/:id`: guard first:
  ```ts
  if (await contactsRepo.isReferenced(Number(req.params.id))) return res.status(409).json({ error: 'contact is used by a letter' })
  ```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/public-send-channels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/public-letters.ts server/routes/admin-letter-assets.ts tests/server/public-send-channels.test.ts
git commit -m "feat(letters): public sms/whatsapp analytics + phone validation + delete guard"
```

---

## Phase 3 — Frontend

### Task 13: API client

**Files:**
- Modify: `src/lib/api-client.ts`

**Interfaces:**
- Produces: `api.admin.letters.create/update` accept `{ title, status, priority, issueTagIds, channels }`; contact create/update accept the widened fields; `api.letters.contacts(q?, channel?)`.

- [ ] **Step 1: Update the client** (no separate unit test; covered by component tests in Tasks 15–17)

Update the letters create/update method bodies to send the new `channels`-bearing payload (type the body as `{ title: string; status: string; priority: string; issueTagIds: number[]; channels: LetterChannelInput[] }`). Add `channel?: ChannelKind` to the contacts getter's query. Add `phone`, `hasWhatsapp`, `photoUrl`, `mkSiteId` to the admin contact create/update bodies. Import the new types from `@/types`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: fewer errors than before; remaining errors are in `AdminLettersPage`/`LetterDetailPage` (fixed next).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-client.ts
git commit -m "feat(letters): channel-aware API client"
```

---

### Task 14: `SmsBodyEditor` component (RTL textarea + live counter)

**Files:**
- Create: `src/components/letters/SmsBodyEditor.tsx`
- Test: `tests/components/SmsBodyEditor.test.tsx`

**Interfaces:**
- Consumes: `analyzeSms` (Task 1).
- Produces:
  ```tsx
  interface SmsBodyEditorProps {
    value: string
    onChange: (v: string) => void
    maxSegments?: number     // default 3
    channelLabel: string     // 'SMS' | 'WhatsApp' (WhatsApp uses a plain char cap, see below)
    mode?: 'sms' | 'whatsapp'
  }
  export default function SmsBodyEditor(props: SmsBodyEditorProps)
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/SmsBodyEditor.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import SmsBodyEditor from '@/components/letters/SmsBodyEditor'

describe('SmsBodyEditor', () => {
  it('shows Hebrew UCS-2 segment info and flags over-limit', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<SmsBodyEditor value="" onChange={onChange} channelLabel="SMS" mode="sms" maxSegments={3} />)
    // 210 Hebrew chars = 4 segments (67/seg after the first) → over the 3-segment cap
    rerender(<SmsBodyEditor value={'ש'.repeat(210)} onChange={onChange} channelLabel="SMS" mode="sms" maxSegments={3} />)
    expect(screen.getByTestId('sms-encoding')).toHaveTextContent(/ucs2|UCS-2/i)
    expect(screen.getByTestId('sms-over-limit')).toBeInTheDocument()
  })

  it('emits typed text', async () => {
    const onChange = vi.fn()
    render(<SmsBodyEditor value="" onChange={onChange} channelLabel="SMS" mode="sms" />)
    await userEvent.type(screen.getByRole('textbox'), 'hi')
    expect(onChange).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/SmsBodyEditor.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```tsx
// src/components/letters/SmsBodyEditor.tsx
import { analyzeSms } from '@/lib/sms-segments'

interface SmsBodyEditorProps {
  value: string
  onChange: (v: string) => void
  maxSegments?: number
  channelLabel: string
  mode?: 'sms' | 'whatsapp'
}

const WHATSAPP_MAX = 2000

export default function SmsBodyEditor({ value, onChange, maxSegments = 3, channelLabel, mode = 'sms' }: SmsBodyEditorProps) {
  const info = analyzeSms(value)
  const over = mode === 'sms' ? info.segments > maxSegments : value.length > WHATSAPP_MAX

  return (
    <div className="flex flex-col gap-1.5" dir="rtl">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="w-full rounded-lg border border-slate-300 p-3 text-sm"
        aria-label={channelLabel}
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        {mode === 'sms' ? (
          <span>
            <span data-testid="sms-encoding">{info.encoding.toUpperCase()}</span>
            {' · '}{info.units} · {info.segments} מקטעים
          </span>
        ) : (
          <span>{value.length} / {WHATSAPP_MAX}</span>
        )}
        {over && (
          <span data-testid="sms-over-limit" className="font-semibold text-red-600">
            חורג מהמגבלה
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/SmsBodyEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/letters/SmsBodyEditor.tsx tests/components/SmsBodyEditor.test.tsx
git commit -m "feat(letters): SMS/WhatsApp body editor with Hebrew-aware counter"
```

---

### Task 15: Channel-tabbed composer in `AdminLettersPage`

**Files:**
- Modify: `src/pages/AdminLettersPage.tsx`
- Test: extend `tests/components/AdminLettersComposer.test.tsx`

**Interfaces:**
- Consumes: `SmsBodyEditor` (Task 14), the existing HTML editor + recipient picker, `api.admin.letters.create/update` (Task 13).
- Produces: a composer that edits `channels: LetterChannelInput[]`; each enabled channel gets a tab; email tab keeps the existing rich editor; SMS/WhatsApp tabs use `SmsBodyEditor`; each tab has its own recipient picker (filtered via `?channel=`) and an availability line.

- [ ] **Step 1: Write the failing test**

Add to `tests/components/AdminLettersComposer.test.tsx` (mock `api.admin.letters` create/update + `api.letters.contacts`). Test: enabling the SMS tab, typing a Hebrew body, and submitting calls `create` with a `channels` array containing `{ kind: 'sms', bodyText: <typed> }`. Assert the email tab still renders the existing HTML editor mock. (Follow the file's existing mock shape — it already mocks `HtmlCodeEditor` and `api.admin.letters`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: FAIL — composer has no channel tabs / doesn't emit `channels`.

- [ ] **Step 3: Implement**

Refactor `NewLetterForm`:
- Replace the flat `subject/bodyHtml/to/cc/bcc` state with `channels: LetterChannelInput[]` plus a set of enabled kinds. Seed from `initialLetter?.channels` when editing.
- Render a channel toggle row (Email / SMS / WhatsApp) and a tab per enabled channel.
- Email tab: existing `HtmlCodeEditor` + Beautify + media + subject input + To/Cc/Bcc `RecipientEditor` (now storing `recipientIds`/`ccIds`/`bccIds`). The recipient picker calls `api.letters.contacts(q, 'email')`.
- SMS/WhatsApp tabs: `SmsBodyEditor` + a single recipient picker (`api.letters.contacts(q, kind)`), plus an availability line: `{unreachableCount} מתוך {total} נמענים ללא טלפון` computed from the picked contacts.
- On submit, build `channels` from the enabled kinds and call `create`/`update` with `{ title, status, priority, issueTagIds, channels }`.

Keep the create-only field-clearing (`if (!isEdit)`) and the keyed-remount edit pattern already in the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "feat(letters): channel-tabbed composer"
```

---

### Task 16: Contact editor — phone, WhatsApp toggle, photo, MK link

**Files:**
- Modify: `src/pages/AdminLettersPage.tsx` (contact management UI)
- Test: extend `tests/components/AdminLettersComposer.test.tsx` (or a contacts-specific component test if one exists)

**Interfaces:**
- Consumes: widened admin contact create/update (Task 13); existing R2 media upload (`api.admin.letters.media`) for photos.
- Produces: contact create/edit form with `phone`, `hasWhatsapp`, `photoUrl` (upload or URL), `mkSiteId`.

- [ ] **Step 1: Write the failing test**

Add a test: filling the contact form with a phone and toggling WhatsApp calls the admin contact create with `{ phone, hasWhatsapp: true }`. Deleting a referenced contact surfaces the 409 message (mock the client to reject with status 409 → assert an inline error).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Extend the contact form: add `phone` input (with a hint "05X… or +9725X…"), a `hasWhatsapp` checkbox, a `photoUrl` field (text + optional "upload" that reuses the media pipeline), and an `mkSiteId` input (numeric; when set, the row shows the derived MK photo). On DELETE 409, show an inline message "לא ניתן למחוק — איש קשר בשימוש". Photos: if `mkSiteId` is set, prefer the MK's cached photo (look it up from `useMkList()`), else `photoUrl`, else initials.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "feat(letters): contact editor — phone, whatsapp, photo, mk link"
```

---

### Task 17: `LetterDetailPage` + public share page — per-recipient send buttons

**Files:**
- Modify: `src/pages/LetterDetailPage.tsx`
- Modify: `server/services/share-publisher.ts` (R2 share-page HTML)
- Test: extend the existing `LetterDetailPage` component test (or add one) + a share-publisher server test

**Interfaces:**
- Consumes: the new `LetterDetailResponse { letter, channels: ChannelSend[] }` (Task 11).
- Produces: email channel → single "open in Gmail"/mailto/copy buttons (existing behavior, now read from `channels[kind=email]`); SMS/WhatsApp channels → a list of per-recipient buttons (photo + name), each firing `api.public.letters.send({ channel, contactId })`.

- [ ] **Step 1: Write the failing test**

Component test: given a mocked detail response with an `email` channel and an `sms` channel with two recipients, assert one Gmail button and two "Send to <name>" buttons render; clicking an SMS button calls the public send with `{ channel: 'sms', contactId }`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/components/LetterDetailPage.test.tsx`
Expected: FAIL — page reads the old top-level `gmailUrl`.

- [ ] **Step 3: Implement**

Rework `LetterDetailPage` to iterate `data.channels`:
- `email`: keep the current three actions, sourced from `channel.mailtoUrl`/`gmailUrl` and `renderedHtml`.
- `sms`/`whatsapp`: render `channel.recipients.map(r => <button>)`, each opening `r.url` (`window.open(r.url, '_blank')` for wa.me; navigate for `sms:`), then `void api.public.letters.send(id, { channel: channel.kind, contactId: r.contactId })`. Show `channel.unavailableCount` as a small note if > 0.

In `server/services/share-publisher.ts`, extend the generated HTML to render each channel: email as the existing block; SMS/WhatsApp as a list of per-recipient anchor links (`<a href="wa.me/…">`), each carrying an `onclick` beacon to `/api/public/letters/:id/send` with the channel + contactId (mirror the existing public-send beacon the share page already uses for mailto/gmail/copy).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/components/LetterDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LetterDetailPage.tsx server/services/share-publisher.ts tests/components/LetterDetailPage.test.tsx
git commit -m "feat(letters): per-recipient sms/whatsapp send buttons on detail + share page"
```

---

### Task 18: Locale strings

**Files:**
- Modify: `src/locales/he.json`, `src/locales/en.json`

- [ ] **Step 1: Add keys** (both files, Hebrew + English):
`letters.channel.email`, `letters.channel.sms`, `letters.channel.whatsapp`, `letters.channel.add`, `letters.sendTo` ("שליחה ל…"/"Send to…"), `letters.unavailableRecipients` ("{{count}} נמענים ללא ערוץ זה"), `letters.overLimit` ("חורג מהמגבלה"), `letters.contact.phone`, `letters.contact.hasWhatsapp`, `letters.contact.photo`, `letters.contact.mk`, `letters.contact.inUse` ("איש קשר בשימוש — לא ניתן למחוק").

- [ ] **Step 2: Verify no missing-key warnings**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx tests/components/LetterDetailPage.test.tsx`
Expected: PASS, no i18n missing-key console errors.

- [ ] **Step 3: Commit**

```bash
git add src/locales/he.json src/locales/en.json
git commit -m "feat(letters): channel + contact locale strings"
```

---

## Phase 4 — Contract migration + full gate

### Task 19: Drop legacy `letters` content columns (contract migration)

**Files:**
- Modify: `server/db/schema/letters.ts` (remove `subject`, `bodyHtml`, `bodyPlain`, `templateId`, `toAddresses`, `ccAddresses`, `bccAddresses` from the `letters` table; remove the `LetterAddress` schema type export if now unused by server code — the backfill script has already run in prod by this point)
- Generate: contract migration via `npm run db:generate`

**Precondition:** This task ships only after Tasks 9–17 are merged AND the backfill (`npm run db:backfill-channels`) has run against every environment. Dropping these columns before backfill destroys legacy content.

- [ ] **Step 1: Remove the columns from the schema** (delete the seven fields from the `letters` table definition; leave everything else).

- [ ] **Step 2: Generate the contract migration**

Run: `npm run db:generate`
Expected: a migration with `ALTER TABLE "letters"."letters" DROP COLUMN ...` for the seven columns.

- [ ] **Step 3: Fix any remaining references**

Run: `npx tsc --noEmit`
Expected: PASS. If the backfill script imports `LetterAddress` from the schema, keep that type or inline it there (the script is historical but must still compile). Adjust imports so the build is clean.

- [ ] **Step 4: Full gate**

Run:
```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/letters.ts server/db/migrations/ scripts/backfill-channels.ts
git commit -m "feat(letters): contract migration — drop legacy content columns"
```

---

## Deployment runbook (do this in order, once, per environment)

1. Deploy code through **Task 18** (expand migration auto-applies on boot; legacy columns still present and readable).
2. Run the backfill against the target DB: `DATABASE_URL=<target> npm run db:backfill-channels`. Verify `migrated` count and spot-check that each old letter now has an `email` channel.
3. Deploy **Task 19** (contract migration drops the legacy columns).
4. Regenerate share pages so existing letters' R2 pages render the new channel layout: `POST /api/admin/letters/regenerate-shares` (existing admin endpoint).

---

## Self-Review notes (spec coverage)

- Data model (`letters` slimmed, `letter_channels`, widened contacts, analytics buckets) → Tasks 4, 8, 12. ✅
- Live recipient resolution / no snapshots → Task 11 (`buildChannelSends` resolves at read time). ✅
- Availability vs. enabled → Tasks 10 (`reachableOn`), 11, 15 (availability line). ✅
- SMS Hebrew limits in editor → Tasks 1, 14. ✅
- Deep-link builders + cross-platform `sms:` form → Task 3. ✅
- Per-recipient send lists → Tasks 11, 17. ✅
- Contact photos (MK-derived + upload) → Task 16. ✅
- Ad-hoc recipient → contact creation → Task 15 (recipient picker "create" path) + backfill find-or-create (Task 7). ✅
- Deletion guard (409) → Tasks 6, 12, 16. ✅
- Phone E.164 normalization → Tasks 2, 12. ✅
- Migration expand→backfill→contract → Tasks 4, 7, 19 + runbook. ✅
- Keep `letters` name → global constraint, all tasks. ✅
- Out of scope (backend sender, message-attached images, opt-in) → not implemented, by design. ✅
