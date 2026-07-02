# Public Shareable Letter Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-render a public, link-previewable HTML page + Open Graph image for every published advocacy letter and serve them from Cloudflare R2, so letters can be shared (WhatsApp/X/Telegram) and pull strangers into a sign-in-to-send funnel.

**Architecture:** On publish/edit, the Express backend renders a standalone share HTML + an OG PNG and uploads both to an R2 bucket (served always-on by Cloudflare); on unpublish/delete it removes them. All generation is gated by a feature flag (default off) and no-ops when R2 env vars are unset, so dev/test/CI and an unprovisioned prod are unaffected.

**Tech Stack:** Express 5 + tsx, Drizzle/Postgres (pglite in tests), `@aws-sdk/client-s3` (R2 is S3-compatible), `satori` (HTML→SVG) + `@resvg/resvg-js` (SVG→PNG), Heebo font. Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-20-public-share-pages-design.md`

## Global Constraints

- **Hebrew-first, RTL** for all user-visible text on the share page and card.
- **Never throw from share publishing** — a share-publish/render/upload failure must be caught and logged, never failing the admin's letter save (same contract as `server/services/email.ts`).
- **No-op without configuration** — if R2 env vars are unset OR the `publicSharePages` flag is off, generation is skipped silently (return, don't error).
- **Published-only** — only `status === 'published'` letters produce objects; any other status (or delete) removes them.
- **No PII** — only admin-authored letter content + recipient *display names* (public officials) ever appear; never member/user data.
- **Reuse the already-sanitized body** — `letters.bodyHtml` is sanitized at store time; do not re-sanitize or introduce a new sanitization path.
- **Object keys:** `letter/<id>.html` (`text/html; charset=utf-8`) and `letter/<id>.png` (`image/png`).

---

## Task 1: Share config module

**Files:**
- Create: `server/services/share-config.ts`
- Test: `tests/server/share-config.test.ts`

**Interfaces:**
- Produces:
  - `interface ShareConfig { r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null; publicBaseUrl: string; appBaseUrl: string }`
  - `getShareConfig(): ShareConfig`
  - `isShareConfigured(): boolean`

- [ ] **Step 1: Write the failing test**

`tests/server/share-config.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { getShareConfig, isShareConfigured } from '../../server/services/share-config'

const KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL', 'APP_PUBLIC_URL']
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

describe('share-config', () => {
  it('is not configured when R2 env vars are missing', () => {
    for (const k of KEYS) delete process.env[k]
    expect(isShareConfigured()).toBe(false)
    expect(getShareConfig().r2).toBeNull()
  })

  it('is configured when all R2 vars + public base url are set', () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'akid'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_BUCKET = 'share'
    process.env.R2_PUBLIC_BASE_URL = 'https://share.example.org/'
    const cfg = getShareConfig()
    expect(isShareConfigured()).toBe(true)
    expect(cfg.r2).toEqual({ accountId: 'acct', accessKeyId: 'akid', secretAccessKey: 'secret', bucket: 'share' })
    expect(cfg.publicBaseUrl).toBe('https://share.example.org') // trailing slash trimmed
  })

  it('defaults appBaseUrl to the GitHub Pages URL', () => {
    delete process.env.APP_PUBLIC_URL
    expect(getShareConfig().appBaseUrl).toBe('https://derlegatlabienus.github.io/liberal-page')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/share-config.test.ts`
Expected: FAIL — cannot find module `share-config`.

- [ ] **Step 3: Implement**

`server/services/share-config.ts`:
```ts
export interface ShareConfig {
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string } | null
  publicBaseUrl: string
  appBaseUrl: string
}

const DEFAULT_APP_URL = 'https://derlegatlabienus.github.io/liberal-page'

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function getShareConfig(): ShareConfig {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env
  const r2 = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
    ? { accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET }
    : null
  return {
    r2,
    publicBaseUrl: trimSlash(process.env.R2_PUBLIC_BASE_URL ?? ''),
    appBaseUrl: trimSlash(process.env.APP_PUBLIC_URL ?? DEFAULT_APP_URL),
  }
}

/** True only when R2 credentials AND a public base URL are present. */
export function isShareConfigured(): boolean {
  const c = getShareConfig()
  return c.r2 !== null && c.publicBaseUrl !== ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/share-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add server/services/share-config.ts tests/server/share-config.test.ts
git commit -m "feat(share): share-config env module (no-op when R2 unset)"
```

---

## Task 2: `publicSharePages` feature flag (seed migration + seed data)

**Files:**
- Create: `server/db/migrations/0022_public_share_pages_flag.sql`
- Create: `server/db/migrations/meta/0022_snapshot.json` (copy of 0021)
- Modify: `server/db/migrations/meta/_journal.json` (append idx 22)
- Modify: `scripts/seed-data/feature-flags.json` (add a `share` group)
- Modify: `scripts/seed-db.ts` (seed the flag for fresh DBs)
- Test: `tests/server/share-flag-migration.test.ts`

**Interfaces:**
- Produces: a `feature_flags` row `name='publicSharePages'`, `enabled=false`, present after migrations run.

- [ ] **Step 1: Write the failing test**

`tests/server/share-flag-migration.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestDb } from './db-harness'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

describe('publicSharePages flag (migration 0022)', () => {
  beforeAll(async () => { await setupTestDb() })
  it('exists and is disabled by default', async () => {
    const flags = await new FeatureFlagsRepository().getAll()
    expect(flags['publicSharePages']).toBeDefined()
    expect(flags['publicSharePages'].enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/share-flag-migration.test.ts`
Expected: FAIL — `flags['publicSharePages']` is undefined.

- [ ] **Step 3: Write the migration SQL**

`server/db/migrations/0022_public_share_pages_flag.sql`:
```sql
-- Seed the publicSharePages feature flag so existing/production DBs get it on boot
-- without a re-seed. Default off: gates backend generation of public R2 share pages.
-- Idempotent.
INSERT INTO "config"."feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('publicSharePages', false, NULL, 'Generate public R2-served share pages for published letters', now())
ON CONFLICT ("name") DO NOTHING;
```
Note: the table is in the `config` schema (see migration `0021_domain_schemas.sql`); the schema-qualified name is required.

- [ ] **Step 4: Create the snapshot copy + journal entry**

Run (creates `0022_snapshot.json` from `0021` with a fresh id, chained prevId):
```bash
cd "$(git rev-parse --show-toplevel)"
node -e "const fs=require('fs');const {randomUUID}=require('crypto');const d='server/db/migrations/meta';const prev=JSON.parse(fs.readFileSync(d+'/0021_snapshot.json','utf8'));const next={...prev,id:randomUUID(),prevId:prev.id};fs.writeFileSync(d+'/0022_snapshot.json',JSON.stringify(next,null,2)+'\n');console.log('wrote 0022_snapshot.json id',next.id,'prevId',next.prevId)"
```
Then append this entry to the `entries` array in `server/db/migrations/meta/_journal.json` (after the idx-21 entry; use the current epoch ms for `when`):
```json
    {
      "idx": 22,
      "version": "7",
      "when": 1782000000000,
      "tag": "0022_public_share_pages_flag",
      "breakpoints": true
    }
```

- [ ] **Step 5: Add to fresh-DB seed**

In `scripts/seed-data/feature-flags.json`, add a top-level group:
```json
  "share": {
    "publicSharePagesEnabled": false
  }
```
In `scripts/seed-db.ts`, alongside the other `ff.setFlag(...)` calls (after the `storagePressure` line ~62), add:
```ts
  await ff.setFlag('publicSharePages', flagsRaw.share.publicSharePagesEnabled, null, 'Generate public R2-served share pages for published letters')
```
and extend the `readJson<{ ... }>('feature-flags.json')` generic type to include `share: { publicSharePagesEnabled: boolean }`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/server/share-flag-migration.test.ts`
Expected: PASS (pglite applies 0022; flag present, disabled).

- [ ] **Step 7: Verify migration metadata is consistent**

Run: `echo "" | npx drizzle-kit generate`
Expected: "No schema changes, nothing to migrate" (the snapshot copy keeps code↔snapshot consistent; no 0023 is created).

- [ ] **Step 8: Commit**
```bash
git add server/db/migrations/0022_public_share_pages_flag.sql server/db/migrations/meta/0022_snapshot.json server/db/migrations/meta/_journal.json scripts/seed-data/feature-flags.json scripts/seed-db.ts tests/server/share-flag-migration.test.ts
git commit -m "feat(share): publicSharePages feature flag (default off) via migration 0022"
```

---

## Task 3: R2 client

**Files:**
- Create: `server/services/r2-client.ts`
- Test: `tests/server/r2-client.test.ts`
- Modify: `package.json` (add `@aws-sdk/client-s3`)

**Interfaces:**
- Consumes: `getShareConfig`, `isShareConfigured` (Task 1).
- Produces:
  - `isR2Configured(): boolean`
  - `putObject(key: string, body: Buffer | string, contentType: string): Promise<boolean>`
  - `deleteObject(key: string): Promise<boolean>`
  - `_resetR2Client(): void` (test-only)

- [ ] **Step 1: Install the SDK**

Run: `npm install @aws-sdk/client-s3`
Expected: added to dependencies.

- [ ] **Step 2: Write the failing test**

`tests/server/r2-client.test.ts`:
```ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const send = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ __type: 'put', input })),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ __type: 'delete', input })),
}))

import { isR2Configured, putObject, deleteObject, _resetR2Client } from '../../server/services/r2-client'

const KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]

function configure() {
  process.env.R2_ACCOUNT_ID = 'acct'; process.env.R2_ACCESS_KEY_ID = 'akid'
  process.env.R2_SECRET_ACCESS_KEY = 'secret'; process.env.R2_BUCKET = 'share'
  process.env.R2_PUBLIC_BASE_URL = 'https://share.example.org'
}

beforeEach(() => { send.mockReset(); _resetR2Client() })
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } ; _resetR2Client() })

describe('r2-client', () => {
  it('no-ops and returns false when unconfigured', async () => {
    for (const k of KEYS) delete process.env[k]
    expect(isR2Configured()).toBe(false)
    expect(await putObject('letter/1.html', '<x>', 'text/html')).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('puts an object with bucket, key and content-type when configured', async () => {
    configure()
    send.mockResolvedValueOnce({})
    expect(await putObject('letter/1.html', '<x>', 'text/html')).toBe(true)
    const cmd = send.mock.calls[0][0]
    expect(cmd.input).toMatchObject({ Bucket: 'share', Key: 'letter/1.html', ContentType: 'text/html' })
  })

  it('returns false (never throws) when the SDK send fails', async () => {
    configure()
    send.mockRejectedValueOnce(new Error('network'))
    expect(await putObject('letter/1.html', '<x>', 'text/html')).toBe(false)
  })

  it('deletes an object when configured', async () => {
    configure()
    send.mockResolvedValueOnce({})
    expect(await deleteObject('letter/1.png')).toBe(true)
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'share', Key: 'letter/1.png' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/r2-client.test.ts`
Expected: FAIL — cannot find module `r2-client`.

- [ ] **Step 4: Implement**

`server/services/r2-client.ts`:
```ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getShareConfig, isShareConfigured } from './share-config'

let client: S3Client | null = null
let inited = false

/** Test-only: drop the lazily-built client so env changes take effect. */
export function _resetR2Client(): void { client = null; inited = false }

export function isR2Configured(): boolean { return isShareConfigured() }

function getClient(): S3Client | null {
  if (!inited) {
    inited = true
    const { r2 } = getShareConfig()
    client = r2
      ? new S3Client({
          region: 'auto',
          endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
        })
      : null
  }
  return client
}

export async function putObject(key: string, body: Buffer | string, contentType: string): Promise<boolean> {
  const c = getClient()
  const { r2 } = getShareConfig()
  if (!c || !r2) return false
  try {
    await c.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: body, ContentType: contentType }))
    return true
  } catch (err) {
    console.error('[share] R2 put failed:', key, err)
    return false
  }
}

export async function deleteObject(key: string): Promise<boolean> {
  const c = getClient()
  const { r2 } = getShareConfig()
  if (!c || !r2) return false
  try {
    await c.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }))
    return true
  } catch (err) {
    console.error('[share] R2 delete failed:', key, err)
    return false
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/r2-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**
```bash
git add server/services/r2-client.ts tests/server/r2-client.test.ts package.json package-lock.json
git commit -m "feat(share): R2 client (S3 SDK) with no-op-when-unconfigured + never-throw"
```

---

## Task 4: Share HTML renderer

**Files:**
- Create: `server/services/share-renderer.ts`
- Test: `tests/server/share-renderer.test.ts`

**Interfaces:**
- Produces:
  - `interface ShareLetterView { id: number; title: string; subject: string; bodyHtml: string; bodyPlain: string; recipientNames: string[]; issueTags: string[] }`
  - `renderShareHtml(view: ShareLetterView, opts: { shareBaseUrl: string; appBaseUrl: string }): string`

- [ ] **Step 1: Write the failing test**

`tests/server/share-renderer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { renderShareHtml, type ShareLetterView } from '../../server/services/share-renderer'

const view: ShareLetterView = {
  id: 42,
  title: 'עצרו את חוק X',
  subject: 'בקשה דחופה',
  bodyHtml: '<p>שלום רב, אנו פונים אליך</p>',
  bodyPlain: 'שלום רב, אנו פונים אליך בבקשה לפעול בנושא החשוב הזה למען חירות הפרט והשוק החופשי בישראל.',
  recipientNames: ['ח"כ ישראל ישראלי'],
  issueTags: ['חירות אזרחית'],
}
const opts = { shareBaseUrl: 'https://share.example.org', appBaseUrl: 'https://app.example.org/liberal-page' }

describe('renderShareHtml', () => {
  const html = renderShareHtml(view, opts)
  it('sets RTL Hebrew document', () => {
    expect(html).toContain('<html lang="he" dir="rtl">')
  })
  it('emits Open Graph tags with title, description, image and url', () => {
    expect(html).toContain('<meta property="og:title" content="עצרו את חוק X">')
    expect(html).toContain('property="og:image" content="https://share.example.org/letter/42.png"')
    expect(html).toContain('property="og:url" content="https://share.example.org/letter/42.html"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    // description = first ~150 chars of bodyPlain
    expect(html).toMatch(/property="og:description" content="שלום רב/)
  })
  it('links the CTA into the app with src=share', () => {
    expect(html).toContain('href="https://app.example.org/liberal-page/letters/42?src=share"')
  })
  it('includes the sanitized body and recipient names', () => {
    expect(html).toContain('<p>שלום רב, אנו פונים אליך</p>')
    expect(html).toContain('ח"כ ישראל ישראלי')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/share-renderer.test.ts`
Expected: FAIL — cannot find module `share-renderer`.

- [ ] **Step 3: Implement (HTML only; OG image added in Task 5)**

`server/services/share-renderer.ts`:
```ts
export interface ShareLetterView {
  id: number
  title: string
  subject: string
  bodyHtml: string   // already sanitized at store time
  bodyPlain: string
  recipientNames: string[]
  issueTags: string[]
}

/** Escape a string for safe use inside an HTML attribute / text node. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function description(bodyPlain: string): string {
  const flat = bodyPlain.replace(/\s+/g, ' ').trim()
  return flat.length > 150 ? flat.slice(0, 149).trimEnd() + '…' : flat
}

export function renderShareHtml(view: ShareLetterView, opts: { shareBaseUrl: string; appBaseUrl: string }): string {
  const shareUrl = `${opts.shareBaseUrl}/letter/${view.id}.html`
  const imageUrl = `${opts.shareBaseUrl}/letter/${view.id}.png`
  const ctaUrl = `${opts.appBaseUrl}/letters/${view.id}?src=share`
  const desc = description(view.bodyPlain)
  const tags = view.issueTags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')
  const recipients = view.recipientNames.map(esc).join(', ')
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(view.title)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(view.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${shareUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(view.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${imageUrl}">
<link rel="canonical" href="${shareUrl}">
<style>
  body { font-family: system-ui, "Heebo", sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px; }
  .card { max-width:680px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:28px; }
  .tag { display:inline-block; background:#e0ecff; color:#1d4ed8; border-radius:999px; padding:2px 10px; font-size:13px; }
  h1 { font-size:24px; margin:12px 0; }
  .to { color:#475569; font-size:14px; margin-bottom:16px; }
  .body { line-height:1.7; }
  .cta { display:block; text-align:center; margin-top:24px; background:#1d4ed8; color:#fff; text-decoration:none; padding:14px; border-radius:8px; font-weight:600; }
  .note { color:#64748b; font-size:12px; margin-top:16px; text-align:center; }
</style>
</head>
<body>
  <div class="card">
    <div>${tags}</div>
    <h1>${esc(view.title)}</h1>
    <div class="to">אל: ${recipients}</div>
    <div class="body">${view.bodyHtml}</div>
    <a class="cta" href="${ctaUrl}">הצטרפו ושלחו לחבר הכנסת</a>
    <p class="note">המשלוחים נספרים באופן אנונימי בלבד — הפלטפורמה אינה מתעדת מי שלח מכתב.</p>
  </div>
</body>
</html>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/share-renderer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add server/services/share-renderer.ts tests/server/share-renderer.test.ts
git commit -m "feat(share): standalone share-page HTML renderer with OG tags + CTA"
```

---

## Task 5: OG share-card image renderer

**Files:**
- Modify: `server/services/share-renderer.ts` (add `renderShareImage`)
- Create: `server/assets/fonts/Heebo-Bold.ttf` (vendored static font)
- Test: `tests/server/share-image.test.ts`
- Modify: `package.json` (add `satori`, `@resvg/resvg-js`)

**Interfaces:**
- Consumes: `ShareLetterView` (Task 4).
- Produces: `renderShareImage(view: ShareLetterView): Promise<Buffer>` — a 1200×630 PNG.

- [ ] **Step 1: Install deps + vendor the font**

Run:
```bash
npm install satori @resvg/resvg-js
mkdir -p server/assets/fonts
curl -fsSL "https://github.com/google/fonts/raw/main/ofl/heebo/Heebo%5Bwght%5D.ttf" -o /tmp/Heebo.ttf
```
Heebo's Google Fonts file is a variable TTF. satori accepts it; we pin weight 700 in the call. Move it into the repo:
```bash
cp /tmp/Heebo.ttf server/assets/fonts/Heebo-Bold.ttf
```
(If the URL changes, any static Heebo `.ttf`/`.otf` works; place it at `server/assets/fonts/Heebo-Bold.ttf`.)

- [ ] **Step 2: Write the failing test**

`tests/server/share-image.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { renderShareImage, type ShareLetterView } from '../../server/services/share-renderer'

const view: ShareLetterView = {
  id: 7, title: 'עצרו את חוק X', subject: 's',
  bodyHtml: '<p>x</p>', bodyPlain: 'x', recipientNames: ['ח"כ פלוני'], issueTags: ['חירות'],
}

describe('renderShareImage', () => {
  it('produces a non-empty PNG buffer', async () => {
    const png = await renderShareImage(view)
    expect(Buffer.isBuffer(png)).toBe(true)
    expect(png.length).toBeGreaterThan(1000)
    // PNG magic number
    expect(png[0]).toBe(0x89); expect(png[1]).toBe(0x50); expect(png[2]).toBe(0x4e); expect(png[3]).toBe(0x47)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/share-image.test.ts`
Expected: FAIL — `renderShareImage` is not exported.

- [ ] **Step 4: Implement (append to `server/services/share-renderer.ts`)**

Add imports at the top of the file:
```ts
import fs from 'fs'
import path from 'path'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
```
Append at the bottom:
```ts
let heeboFont: Buffer | null = null
function getFont(): Buffer {
  if (!heeboFont) heeboFont = fs.readFileSync(path.join(process.cwd(), 'server/assets/fonts/Heebo-Bold.ttf'))
  return heeboFont
}

function clamp(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s }

/** 1200x630 branded share card: wordmark + letter title + CTA line. Hebrew/RTL. */
export async function renderShareImage(view: ShareLetterView): Promise<Buffer> {
  // satori accepts a React-element-shaped plain object (no JSX needed).
  const node = {
    type: 'div',
    props: {
      style: {
        width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: '64px', backgroundColor: '#1d4ed8',
        color: '#ffffff', direction: 'rtl', textAlign: 'right', fontFamily: 'Heebo',
      },
      children: [
        { type: 'div', props: { style: { fontSize: 32, opacity: 0.85 }, children: 'הליברלים בליכוד' } },
        { type: 'div', props: { style: { fontSize: 72, fontWeight: 700, lineHeight: 1.15 }, children: clamp(view.title, 90) } },
        { type: 'div', props: { style: { fontSize: 36, opacity: 0.95 }, children: 'הצטרפו ושלחו לחבר הכנסת ←' } },
      ],
    },
  }
  const svg = await satori(node as Parameters<typeof satori>[0], {
    width: 1200, height: 630,
    fonts: [{ name: 'Heebo', data: getFont(), weight: 700, style: 'normal' }],
  })
  return Buffer.from(new Resvg(svg).render().asPng())
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/share-image.test.ts`
Expected: PASS (1 test). If it fails on font load, confirm `server/assets/fonts/Heebo-Bold.ttf` exists and is a valid TTF.

- [ ] **Step 6: Commit**
```bash
git add server/services/share-renderer.ts server/assets/fonts/Heebo-Bold.ttf tests/server/share-image.test.ts package.json package-lock.json
git commit -m "feat(share): OG share-card PNG renderer (satori + resvg, Heebo)"
```

---

## Task 6: Share publisher (orchestration)

**Files:**
- Create: `server/services/share-publisher.ts`
- Test: `tests/server/share-publisher.test.ts`

**Interfaces:**
- Consumes: `renderShareHtml`, `renderShareImage`, `ShareLetterView` (Tasks 4–5); `putObject`, `deleteObject`, `isR2Configured` (Task 3); `getShareConfig` (Task 1); `LettersRepository.getById`, `LetterIssueTagsRepository.list`, `FeatureFlagsRepository.isEnabled`. (`isR2Configured` already wraps `isShareConfigured`, so it is the single configuration gate.)
- Produces:
  - `syncShareForLetter(letterId: number): Promise<void>` — publish if (flag on + configured + status published), else remove. Never throws.
  - `removeShareForLetter(letterId: number): Promise<void>` — delete both objects. Never throws.

- [ ] **Step 1: Write the failing test**

`tests/server/share-publisher.test.ts`:
```ts
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letters, letterIssueTags } from '../../server/db/schema'
import { LettersRepository } from '../../server/repositories/letters-repository'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

const put = vi.fn(); const del = vi.fn()
vi.mock('../../server/services/r2-client', () => ({
  isR2Configured: () => true,
  putObject: (...a: unknown[]) => put(...a),
  deleteObject: (...a: unknown[]) => del(...a),
}))
vi.mock('../../server/services/share-renderer', () => ({
  renderShareHtml: () => '<html>card</html>',
  renderShareImage: async () => Buffer.from('PNG'),
}))

import { syncShareForLetter, removeShareForLetter } from '../../server/services/share-publisher'

const lettersRepo = new LettersRepository()
const flags = new FeatureFlagsRepository()
const BASE = { title: 'כותרת', subject: 'נושא', bodyHtml: '<p>גוף</p>', bodyPlain: 'גוף', toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ פלוני' }] }

describe('share-publisher', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    put.mockReset(); del.mockReset(); put.mockResolvedValue(true); del.mockResolvedValue(true)
    await db.delete(letters); await db.delete(letterIssueTags)
    await flags.setFlag('publicSharePages', true, null, 'x')
  })

  it('publishes both objects for a published letter when the flag is on', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await syncShareForLetter(l.id)
    expect(put).toHaveBeenCalledTimes(2)
    const keys = put.mock.calls.map((c) => c[0]).sort()
    expect(keys).toEqual([`letter/${l.id}.html`, `letter/${l.id}.png`])
  })

  it('removes objects for a draft (non-published) letter', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'draft' })
    await syncShareForLetter(l.id)
    expect(put).not.toHaveBeenCalled()
    expect(del).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the flag is off', async () => {
    await flags.setFlag('publicSharePages', false, null, 'x')
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await syncShareForLetter(l.id)
    expect(put).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled()
  })

  it('removeShareForLetter deletes both objects', async () => {
    await removeShareForLetter(99)
    const keys = del.mock.calls.map((c) => c[0]).sort()
    expect(keys).toEqual(['letter/99.html', 'letter/99.png'])
  })

  it('never throws when rendering/upload fails', async () => {
    put.mockRejectedValue(new Error('boom'))
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await expect(syncShareForLetter(l.id)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/share-publisher.test.ts`
Expected: FAIL — cannot find module `share-publisher`.

- [ ] **Step 3: Implement**

`server/services/share-publisher.ts`:
```ts
import { LettersRepository } from '../repositories/letters-repository'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { getShareConfig } from './share-config'
import { isR2Configured, putObject, deleteObject } from './r2-client'
import { renderShareHtml, renderShareImage, type ShareLetterView } from './share-renderer'
import type { LetterAddress } from '../db/schema'

const lettersRepo = new LettersRepository()
const tagsRepo = new LetterIssueTagsRepository()
const flagsRepo = new FeatureFlagsRepository()

const htmlKey = (id: number) => `letter/${id}.html`
const imageKey = (id: number) => `letter/${id}.png`

/** Publish a published letter's share objects, or remove them otherwise. Never throws. */
export async function syncShareForLetter(letterId: number): Promise<void> {
  try {
    if (!isR2Configured()) return
    if (!(await flagsRepo.isEnabled('publicSharePages'))) return

    const letter = await lettersRepo.getById(letterId)
    if (!letter || letter.status !== 'published') {
      await removeShareForLetter(letterId)
      return
    }

    const allTags = await tagsRepo.list()
    const tagIds = letter.issueTagIds as number[]
    const view: ShareLetterView = {
      id: letter.id,
      title: letter.title,
      subject: letter.subject,
      bodyHtml: letter.bodyHtml,
      bodyPlain: letter.bodyPlain,
      recipientNames: (letter.toAddresses as LetterAddress[]).map((a) => a.display_name),
      issueTags: allTags.filter((t) => tagIds.includes(t.id)).map((t) => t.name),
    }
    const { publicBaseUrl, appBaseUrl } = getShareConfig()
    const html = renderShareHtml(view, { shareBaseUrl: publicBaseUrl, appBaseUrl })
    const png = await renderShareImage(view)
    await putObject(htmlKey(letter.id), html, 'text/html; charset=utf-8')
    await putObject(imageKey(letter.id), png, 'image/png')
  } catch (err) {
    console.error('[share] sync failed for letter', letterId, err)
  }
}

/** Remove a letter's share objects (idempotent). Never throws. */
export async function removeShareForLetter(letterId: number): Promise<void> {
  try {
    if (!isR2Configured()) return
    await deleteObject(htmlKey(letterId))
    await deleteObject(imageKey(letterId))
  } catch (err) {
    console.error('[share] remove failed for letter', letterId, err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/share-publisher.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add server/services/share-publisher.ts tests/server/share-publisher.test.ts
git commit -m "feat(share): share-publisher orchestration (publish/remove, flag-gated, never-throws)"
```

---

## Task 7: Wire admin-letters routes to the publisher

**Files:**
- Modify: `server/routes/admin-letters.ts` (create/update/delete handlers)
- Test: `tests/server/admin-letters-share-hook.test.ts`

**Interfaces:**
- Consumes: `syncShareForLetter`, `removeShareForLetter` (Task 6).

- [ ] **Step 1: Write the failing test**

`tests/server/admin-letters-share-hook.test.ts`:
```ts
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letters } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'

const sync = vi.fn().mockResolvedValue(undefined)
const remove = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/services/share-publisher', () => ({
  syncShareForLetter: (...a: unknown[]) => sync(...a),
  removeShareForLetter: (...a: unknown[]) => remove(...a),
}))

import adminLettersRouter from '../../server/routes/admin-letters'

const app = express()
app.use(express.json())
app.use('/api/admin/letters', adminLettersRouter)
let token: string

async function flush() { await new Promise((r) => setImmediate(r)) }

describe('admin-letters share hooks', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    sync.mockClear(); remove.mockClear()
    await db.delete(refreshTokens); await db.delete(users); await db.delete(letters)
    const [u] = await db.insert(users).values({ label: 'a@x.com', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'a@x.com', name: 'A', role: 'admin' })
  })

  const body = { title: 't', subject: 's', bodyHtml: '<p>x</p>', toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ' }], status: 'published' }

  it('syncs share on create', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send(body)
    expect(res.status).toBe(201)
    await flush()
    expect(sync).toHaveBeenCalledWith(res.body.letter.id)
  })

  it('syncs share on update', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send(body)
    sync.mockClear()
    await request(app).put(`/api/admin/letters/${created.body.letter.id}`).set('Authorization', `Bearer ${token}`).send({ title: 'new' })
    await flush()
    expect(sync).toHaveBeenCalledWith(created.body.letter.id)
  })

  it('removes share on delete', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send(body)
    await request(app).delete(`/api/admin/letters/${created.body.letter.id}`).set('Authorization', `Bearer ${token}`)
    await flush()
    expect(remove).toHaveBeenCalledWith(created.body.letter.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-letters-share-hook.test.ts`
Expected: FAIL — `sync`/`remove` not called (hooks not wired).

- [ ] **Step 3: Implement**

In `server/routes/admin-letters.ts`, add the import after the existing imports:
```ts
import { syncShareForLetter, removeShareForLetter } from '../services/share-publisher'
```
In the `POST /` handler, after `const letter = await lettersRepo.create(...)` and before `res.status(201).json({ letter })`:
```ts
    setImmediate(() => { syncShareForLetter(letter.id) })
```
In the `PUT /:id` handler, after `const letter = await lettersRepo.getById(id)` and before `res.json({ letter })`:
```ts
    setImmediate(() => { syncShareForLetter(id) })
```
In the `DELETE /:id` handler, after `await lettersRepo.delete(Number(req.params.id))` and before `res.json({ ok: true })`:
```ts
    setImmediate(() => { removeShareForLetter(Number(req.params.id)) })
```
(The `PATCH /:id/pin` handler is intentionally NOT hooked — pinning doesn't change the public page content.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/admin-letters-share-hook.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add server/routes/admin-letters.ts tests/server/admin-letters-share-hook.test.ts
git commit -m "feat(share): regenerate/remove share pages on letter create/update/delete"
```

---

## Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md` (env vars + the share-publish behavior)
- Modify: `docs/architecture.md` (one line on public share pages)
- Modify: `BACKLOG.md` (record the feature)

- [ ] **Step 1: Update CLAUDE.md**

Under the architecture/letters area, add a short paragraph:
```markdown
Published letters are mirrored to public, link-previewable pages on Cloudflare R2
(`server/services/share-publisher.ts` → `share-renderer` + `r2-client`), regenerated on
create/update and removed on unpublish/delete. Gated by the `publicSharePages` flag (default
off) and no-ops unless these env vars are set: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (and optional `APP_PUBLIC_URL` for the
sign-in CTA target).
```

- [ ] **Step 2: Update docs/architecture.md**

Add a bullet near the letters/data description:
```markdown
- **Public share pages:** published letters are rendered to a standalone HTML page + OG image and uploaded to Cloudflare R2 for shareable link previews; see `server/services/share-*`.
```

- [ ] **Step 3: Update BACKLOG.md**

Add under a "Shipped / banked ideas" note (or the relevant section):
```markdown
### ✅ Public shareable letter pages — 2026-06-21
Published letters mirror to public R2-served pages with OG link previews + a sign-in-to-send CTA
(organic-growth funnel). Backend renders HTML + OG card on publish (satori/resvg), uploads to R2;
gated by `publicSharePages` flag (default off) and no-ops without R2 env. Ops prerequisite to go
live: provision a Cloudflare R2 bucket + custom domain and set the env vars, then enable the flag.
Spec/plan: `docs/superpowers/specs/2026-06-20-public-share-pages-design.md`,
`docs/superpowers/plans/2026-06-21-public-share-pages.md`.
```

- [ ] **Step 4: Commit**
```bash
git add CLAUDE.md docs/architecture.md BACKLOG.md
git commit -m "docs(share): document public share pages + R2 env vars"
```

---

## Final verification (after all tasks)

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm test`  (all new suites green; existing suites unaffected — share publishing no-ops without R2 env)
- [ ] `npm run build`
- [ ] Confirm `echo "" | npx drizzle-kit generate` reports **no schema changes** (migration 0022 metadata consistent).
- [ ] **Manual (optional, requires a test R2 bucket):** set the R2 env vars + enable the `publicSharePages` flag, publish a letter, confirm `letter/<id>.html` and `letter/<id>.png` exist in the bucket and the HTML carries the OG tags; paste the public URL into a link-preview debugger to see the card.

## Notes for the implementer

- **This is the only prod-affecting migration** (0022) — but it's a data-only, idempotent flag insert into `config.feature_flags`, default off; it changes no behavior until the flag is enabled and R2 is configured. Safe to ship; no Neon dry-run needed beyond the standard suite.
- Everything else is dormant in prod until the ops prerequisite (R2 bucket + domain + env vars) is met and the flag is flipped — so this can be merged and deployed with zero user-visible change.
- **Deferred (per spec, approved):** the CTA link carries `?src=share` (Task 4), but *logging* share-originated arrivals in the app (reading that param → firing the existing anonymous analytics) is out of scope for this plan — a later lightweight pass.
