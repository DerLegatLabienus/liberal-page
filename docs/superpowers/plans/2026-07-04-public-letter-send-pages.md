# Public Per-Letter Send Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the R2 share page into a public, no-login send surface (mailto/Gmail/copy + a correct Hebrew preview image), with public sends counted in separate analytics buckets — to maximize letters sent.

**Architecture:** Static pages already generated to R2 by `share-publisher` on letter create/update/delete. This plan (1) fixes the OG-card reversed Hebrew via a `bidi-js` reorder before satori, (2) adds a public no-auth send-tracking endpoint using distinct `public_*` buckets, (3) expands the generated HTML into a send page with mailto/Gmail/copy controls + a `sendBeacon` tracking ping, and (4) groups member-vs-public sends in the admin dashboard.

**Tech Stack:** Express 5, Drizzle/Postgres, satori + @resvg/resvg-js, **bidi-js** (new direct dep), React 18, Vitest + supertest.

## Global Constraints

- Approach **A only**: static R2 pages; no server-rendered public route, no SPA route, no hybrid live-fetch.
- Public send counters use **separate buckets**: `public_mailto`, `public_gmail`, `public_copy` — never the member buckets (`mailto`, `copy`).
- The public send-tracking endpoint is **no-auth**, mounted outside `requireAuth`, and gated by `lettersEnabled` **and** letter `status = 'published'`.
- The page's tracking uses `navigator.sendBeacon` with the **action in the query string** (`?action=…`) — no request body, so no CORS and no body-parser needed.
- OG-card Hebrew fix uses **`bidi-js` reorder to visual order**, never a naive string reverse.
- Do not change the authenticated in-app letters flow, and do not commit the untracked `.claude/settings.json` / `skills-lock.json`.
- Reuses existing R2 env; adds optional `API_PUBLIC_URL` (defaulted to `https://liberal-page.onrender.com`).

---

### Task 1: OG-card Hebrew fix (bidi reorder before satori)

**Files:**
- Install: `bidi-js` (make the transitive dep a direct dep)
- Create: `server/services/bidi.ts`
- Modify: `server/services/share-renderer.ts` (extract `buildOgCardNode`, reorder card strings)
- Test: `tests/server/bidi.test.ts`, and extend `tests/server/share-renderer.test.ts`

**Interfaces:**
- Produces: `toVisualOrder(str: string, baseDir?: 'rtl' | 'ltr'): string`; `buildOgCardNode(view: ShareLetterView): object` (the satori node).

- [ ] **Step 1: Install bidi-js as a direct dependency**

Run: `npm install bidi-js@^1.0.3`
Expected: added to `package.json` dependencies (it was only transitive before).

- [ ] **Step 2: Write the failing test for the reorder helper**

```ts
// tests/server/bidi.test.ts
import { describe, it, expect } from 'vitest'
import { toVisualOrder } from '../../server/services/bidi'

describe('toVisualOrder', () => {
  it('reverses pure Hebrew to visual order', () => {
    expect(toVisualOrder('שלום')).toBe('םולש')
  })
  it('flips Hebrew but keeps LTR digit runs intact', () => {
    expect(toVisualOrder('חוק 123 לישראל')).toBe('לארשיל 123 קוח')
  })
  it('returns an empty string unchanged', () => {
    expect(toVisualOrder('')).toBe('')
  })
})
```

- [ ] **Step 3: Run it — verify RED**

Run: `npx vitest run tests/server/bidi.test.ts`
Expected: FAIL — cannot find module `server/services/bidi`.

- [ ] **Step 4: Implement the helper**

```ts
// server/services/bidi.ts
import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

/**
 * Reorder a (possibly mixed Hebrew/LTR) string from logical to VISUAL order, so a
 * renderer that lays glyphs out left-to-right without applying the Unicode bidi
 * algorithm (e.g. satori) displays Hebrew correctly. LTR runs (digits/Latin) stay put.
 */
export function toVisualOrder(str: string, baseDir: 'rtl' | 'ltr' = 'rtl'): string {
  if (!str) return str
  const { levels } = bidi.getEmbeddingLevels(str, baseDir)
  return bidi.getReorderedString(str, {
    levels,
    paragraphs: [{ start: 0, end: str.length, level: baseDir === 'rtl' ? 1 : 0 }],
  })
}
```

- [ ] **Step 5: Run it — verify GREEN**

Run: `npx vitest run tests/server/bidi.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Extract the card node and apply the reorder**

In `server/services/share-renderer.ts`, add the import at the top:

```ts
import { toVisualOrder } from './bidi'
```

Replace the body of `renderShareImage` (the inline `node` object + the satori call) so the node is built by a new exported pure function with each card string reordered. Replace:

```ts
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
```

with:

```ts
  const svg = await satori(buildOgCardNode(view) as Parameters<typeof satori>[0], {
```

and add this exported function just above `renderShareImage`:

```ts
/** Build the satori node for the 1200x630 OG card, with every text run reordered to
 *  VISUAL order (satori has no bidi, so Hebrew would otherwise render reversed). */
export function buildOgCardNode(view: ShareLetterView) {
  return {
    type: 'div',
    props: {
      style: {
        width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: '64px', backgroundColor: '#1d4ed8',
        color: '#ffffff', direction: 'rtl', textAlign: 'right', fontFamily: 'Heebo',
      },
      children: [
        { type: 'div', props: { style: { fontSize: 32, opacity: 0.85 }, children: toVisualOrder('הליברלים בליכוד') } },
        { type: 'div', props: { style: { fontSize: 72, fontWeight: 700, lineHeight: 1.15 }, children: toVisualOrder(clamp(view.title, 90)) } },
        { type: 'div', props: { style: { fontSize: 36, opacity: 0.95 }, children: toVisualOrder('הצטרפו ושלחו לחבר הכנסת ←') } },
      ],
    },
  }
}
```

- [ ] **Step 7: Add a test that the card title is reordered**

Append to `tests/server/share-renderer.test.ts`:

```ts
import { buildOgCardNode } from '../../server/services/share-renderer'
import { toVisualOrder } from '../../server/services/bidi'

describe('buildOgCardNode', () => {
  it('reorders the card title to visual order', () => {
    // buildOgCardNode only reads `title`; cast a partial view so this test doesn't
    // couple to unrelated ShareLetterView fields (which grow in Task 3).
    const node: any = buildOgCardNode({ id: 1, title: 'חוק הבריאות 2026' } as any)
    expect(node.props.children[1].props.children).toBe(toVisualOrder('חוק הבריאות 2026'))
  })
})
```

- [ ] **Step 8: Run renderer tests + typecheck**

Run: `npx vitest run tests/server/bidi.test.ts tests/server/share-renderer.test.ts tests/server/share-image.test.ts`
Expected: PASS (share-image still returns a PNG buffer; card node reordered).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json server/services/bidi.ts server/services/share-renderer.ts tests/server/bidi.test.ts tests/server/share-renderer.test.ts
git commit -m "fix(share): reorder Hebrew to visual order for the OG card (bidi-js)"
```

---

### Task 2: Public send-tracking endpoint + separate buckets

**Files:**
- Modify: `server/repositories/letter-analytics-repository.ts` (widen `record` action type)
- Create: `server/routes/public-letters.ts`
- Modify: `server/index.ts` (mount the router)
- Test: `tests/server/public-letters-route.test.ts`

**Interfaces:**
- Consumes: `LettersRepository.getById`, `LetterAnalyticsRepository.record`, `FeatureFlagsRepository.isEnabled` (existing).
- Produces: `POST /api/public/letters/:id/send?action=mailto|gmail|copy` → records `public_*` bucket, returns `204`.

- [ ] **Step 1: Widen the analytics `record` action type**

In `server/repositories/letter-analytics-repository.ts`, add an exported type and use it. Add near the top (after the `LifetimeStats` interface):

```ts
export type SendAction = 'mailto' | 'copy' | 'public_mailto' | 'public_gmail' | 'public_copy'
```

Change the `record` signature from:

```ts
  async record(letterId: number, action: 'mailto' | 'copy', now: Date = new Date()): Promise<void> {
```

to:

```ts
  async record(letterId: number, action: SendAction, now: Date = new Date()): Promise<void> {
```

(The private `bump` already takes `action: string`, so no other change.)

- [ ] **Step 2: Write the failing route test**

```ts
// tests/server/public-letters-route.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letters } from '../../server/db/schema'
import { LettersRepository } from '../../server/repositories/letters-repository'
import { LetterAnalyticsRepository } from '../../server/repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'
import publicLettersRouter from '../../server/routes/public-letters'

const app = express()
app.use('/api/public/letters', publicLettersRouter)

const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flags = new FeatureFlagsRepository()
const BASE = { title: 'כ', subject: 'נ', bodyHtml: '<p>x</p>', bodyPlain: 'x', toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ' }] }

const flush = () => new Promise((r) => setImmediate(r))

describe('POST /api/public/letters/:id/send', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letters); await flags.setFlag('lettersEnabled', true, 'True', 'x') })

  it('204s and records a public_mailto send for a published letter', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`)
    expect(res.status).toBe(204)
    await flush()
    const stats = await analyticsRepo.getLifetimeForLetters([l.id])
    expect(stats.get(l.id)?.breakdown.public_mailto).toBe(1)
    expect(stats.get(l.id)?.breakdown.mailto).toBeUndefined() // member bucket untouched
  })

  it('204s without recording for a draft letter', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'draft' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=gmail`)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  it('204s without recording for an unknown action or id', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    expect((await request(app).post(`/api/public/letters/${l.id}/send?action=bogus`)).status).toBe(204)
    expect((await request(app).post(`/api/public/letters/999999/send?action=copy`)).status).toBe(204)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  it('does not double-count a rapid repeat from the same ip/letter/action', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=copy`)
    await request(app).post(`/api/public/letters/${l.id}/send?action=copy`)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_copy).toBe(1)
  })
})
```

- [ ] **Step 3: Run it — verify RED**

Run: `npx vitest run tests/server/public-letters-route.test.ts`
Expected: FAIL — cannot find module `server/routes/public-letters`.

- [ ] **Step 4: Implement the public router**

```ts
// server/routes/public-letters.ts
import { Router } from 'express'
import { LettersRepository } from '../repositories/letters-repository'
import { LetterAnalyticsRepository } from '../repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'

const router = Router()
const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flagsRepo = new FeatureFlagsRepository()

// Public page actions → their dedicated analytics buckets (never the member buckets).
const BUCKET = { mailto: 'public_mailto', gmail: 'public_gmail', copy: 'public_copy' } as const
type PublicAction = keyof typeof BUCKET

// Light anti-noise throttle: ignore a repeat (ip, letter, action) within the window.
const WINDOW_MS = 10_000
const seen = new Map<string, number>()
function throttled(key: string): boolean {
  const now = Date.now()
  const prev = seen.get(key)
  if (prev && now - prev < WINDOW_MS) return true
  seen.set(key, now)
  if (seen.size > 5000) for (const [k, t] of seen) if (now - t > WINDOW_MS) seen.delete(k)
  return false
}

// POST /api/public/letters/:id/send?action=mailto|gmail|copy
// No auth. Fire-and-forget: always 204; records only for a published letter when lettersEnabled.
router.post('/:id/send', async (req, res) => {
  const id = Number(req.params.id)
  const action = String(req.query.action || '') as PublicAction
  if (!Number.isInteger(id) || id <= 0 || !(action in BUCKET)) return res.status(204).end()
  try {
    if (!(await flagsRepo.isEnabled('lettersEnabled'))) return res.status(204).end()
    const letter = await lettersRepo.getById(id)
    if (!letter || letter.status !== 'published') return res.status(204).end()
    const ip = ((req.headers['x-forwarded-for'] as string) || req.ip || '').split(',')[0].trim()
    if (throttled(`${ip}:${id}:${action}`)) return res.status(204).end()
    setImmediate(async () => {
      try {
        await analyticsRepo.record(id, BUCKET[action])
        await lettersRepo.incrementActivityScore(id)
      } catch (err) {
        console.error('[public-letters] record failed:', err)
      }
    })
    res.status(204).end()
  } catch (err) {
    console.error('[public-letters] send failed:', err)
    res.status(204).end()
  }
})

export default router
```

- [ ] **Step 5: Mount it (public — outside requireAuth)**

In `server/index.ts`, add the import next to the other route imports:

```ts
import publicLettersRouter from './routes/public-letters'
```

and mount it with the other `app.use('/api/...')` lines (it has no auth middleware, so it's public):

```ts
app.use('/api/public/letters', publicLettersRouter)
```

- [ ] **Step 6: Run it — verify GREEN + typecheck**

Run: `npx vitest run tests/server/public-letters-route.test.ts`
Expected: PASS (4 tests).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit**

```bash
git add server/repositories/letter-analytics-repository.ts server/routes/public-letters.ts server/index.ts tests/server/public-letters-route.test.ts
git commit -m "feat(share): public no-auth send-tracking endpoint (separate public_* buckets)"
```

---

### Task 3: The send page (evolve `renderShareHtml`)

**Files:**
- Modify: `server/services/share-renderer.ts` (`ShareLetterView` + `renderShareHtml`)
- Modify: `server/services/share-config.ts` (add `apiBaseUrl`)
- Modify: `server/services/share-publisher.ts` (populate the new view fields + pass `apiBaseUrl`)
- Test: extend `tests/server/share-renderer.test.ts`

**Interfaces:**
- Consumes: `buildMailtoUrl`, `buildGmailComposeUrl` from `./letter-utils`; `getShareConfig()` (now with `apiBaseUrl`).
- Produces: `renderShareHtml(view, opts: { shareBaseUrl: string; appBaseUrl: string; apiBaseUrl: string }): string` — a self-contained public send page.

- [ ] **Step 1: Extend `ShareLetterView` with recipient addresses**

In `server/services/share-renderer.ts`, add `LetterAddress` to the imports and extend the interface:

```ts
import type { LetterAddress } from '../db/schema'
```
```ts
export interface ShareLetterView {
  id: number
  title: string
  subject: string
  bodyHtml: string   // already sanitized at store time
  bodyPlain: string
  recipientNames: string[]
  issueTags: string[]
  toAddresses?: LetterAddress[]
  ccAddresses?: LetterAddress[]
  bccAddresses?: LetterAddress[]
}
```

(Optional so existing renderer/image tests — whose view objects predate these fields — keep compiling; `renderShareHtml` defaults them to `[]`.)

- [ ] **Step 2: Add `apiBaseUrl` to share-config**

In `server/services/share-config.ts`, add to the `ShareConfig` interface and `getShareConfig()`:

```ts
// in the interface:
  apiBaseUrl: string
```
```ts
// in the returned object (alongside appBaseUrl):
    apiBaseUrl: trimSlash(process.env.API_PUBLIC_URL ?? 'https://liberal-page.onrender.com'),
```

- [ ] **Step 3: Write the failing send-page test**

Append to `tests/server/share-renderer.test.ts`:

```ts
import { renderShareHtml } from '../../server/services/share-renderer'

describe('renderShareHtml (public send page)', () => {
  const view = {
    id: 7, title: 'חוק הבריאות', subject: 'נושא', bodyHtml: '<p>גוף המכתב</p>', bodyPlain: 'גוף המכתב',
    recipientNames: ['ח"כ פלוני'], issueTags: ['בריאות'],
    toAddresses: [{ email: 'mk@knesset.gov.il', display_name: 'ח"כ פלוני' }], ccAddresses: [], bccAddresses: [],
  }
  const html = renderShareHtml(view, { shareBaseUrl: 'https://pub.r2.dev', appBaseUrl: 'https://app', apiBaseUrl: 'https://api' })

  it('has the OG image meta', () => {
    expect(html).toContain('property="og:image"')
    expect(html).toContain('https://pub.r2.dev/letter/7.png')
  })
  it('has a mailto send link to the MK with the subject and body', () => {
    expect(html).toContain('href="mailto:mk@knesset.gov.il?')
    expect(html).toContain('subject=' + encodeURIComponent('נושא'))
  })
  it('has a Gmail compose link', () => {
    expect(html).toContain('https://mail.google.com/mail/?')
  })
  it('embeds the letter body and a copy control', () => {
    expect(html).toContain('גוף המכתב')
    expect(html).toContain('id="copy-btn"')
  })
  it('tracks sends via sendBeacon to the public endpoint (action appended at runtime)', () => {
    expect(html).toContain('navigator.sendBeacon')
    expect(html).toContain('https://api/api/public/letters/7/send')
    expect(html).toContain("'?action=' + action")
  })
})
```

- [ ] **Step 4: Run it — verify RED**

Run: `npx vitest run tests/server/share-renderer.test.ts`
Expected: FAIL — new assertions (mailto/gmail/copy/sendBeacon) not present.

- [ ] **Step 5: Rewrite `renderShareHtml` into a send page**

In `server/services/share-renderer.ts`, add the builder import at the top:

```ts
import { buildMailtoUrl, buildGmailComposeUrl } from './letter-utils'
```

Change the signature and the returned HTML. Replace the whole `renderShareHtml` function with:

```ts
export function renderShareHtml(view: ShareLetterView, opts: { shareBaseUrl: string; appBaseUrl: string; apiBaseUrl: string }): string {
  const shareUrl = `${opts.shareBaseUrl}/letter/${view.id}.html`
  const imageUrl = `${opts.shareBaseUrl}/letter/${view.id}.png`
  const learnMoreUrl = `${opts.appBaseUrl}/letters/${view.id}?src=share`
  const desc = description(view.bodyPlain)
  const tags = view.issueTags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')
  const recipients = view.recipientNames.map(esc).join(', ')
  const to = view.toAddresses ?? []
  const cc = view.ccAddresses ?? []
  const bcc = view.bccAddresses ?? []
  const mailtoUrl = buildMailtoUrl(to, cc, bcc, view.subject, view.bodyPlain)
  const gmailUrl = buildGmailComposeUrl(to, cc, bcc, view.subject, view.bodyPlain)
  const track = `${opts.apiBaseUrl}/api/public/letters/${view.id}/send`
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(view.title)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${escAttr(view.title)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${shareUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(view.title)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<meta name="twitter:image" content="${imageUrl}">
<link rel="canonical" href="${shareUrl}">
<style>
  body { font-family: system-ui, "Heebo", sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px; }
  .card { max-width:680px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:28px; }
  .tag { display:inline-block; background:#e0ecff; color:#1d4ed8; border-radius:999px; padding:2px 10px; font-size:13px; }
  h1 { font-size:24px; margin:12px 0; }
  .to { color:#475569; font-size:14px; margin-bottom:16px; }
  .body { line-height:1.7; }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:24px; }
  .btn { flex:1 1 160px; text-align:center; background:#1d4ed8; color:#fff; text-decoration:none; padding:14px; border-radius:8px; font-weight:600; border:0; font-size:16px; cursor:pointer; }
  .btn.secondary { background:#e2e8f0; color:#0f172a; }
  .note { color:#64748b; font-size:12px; margin-top:16px; text-align:center; }
  .learn { display:block; text-align:center; margin-top:12px; color:#1d4ed8; font-size:13px; }
</style>
</head>
<body>
  <div class="card">
    <div>${tags}</div>
    <h1>${esc(view.title)}</h1>
    <div class="to">אל: ${recipients}</div>
    <div class="body">${view.bodyHtml}</div>
    <div class="actions">
      <a class="btn" id="send-mailto" href="${escAttr(mailtoUrl)}">שלחו במייל</a>
      <a class="btn" id="send-gmail" href="${escAttr(gmailUrl)}" target="_blank" rel="noopener">פתחו ב-Gmail</a>
      <button class="btn secondary" id="copy-btn" type="button">העתקת המכתב</button>
    </div>
    <p class="note">המשלוחים נספרים באופן אנונימי ומצרפי בלבד — הפלטפורמה אינה מתעדת מי שלח מכתב.</p>
    <a class="learn" href="${learnMoreUrl}">על הליברלים בליכוד ←</a>
  </div>
  <script>
    (function () {
      var track = ${JSON.stringify(track)};
      function ping(action) { try { navigator.sendBeacon(track + '?action=' + action); } catch (e) {} }
      var m = document.getElementById('send-mailto'); if (m) m.addEventListener('click', function () { ping('mailto'); });
      var g = document.getElementById('send-gmail'); if (g) g.addEventListener('click', function () { ping('gmail'); });
      var c = document.getElementById('copy-btn');
      if (c) c.addEventListener('click', function () {
        var body = document.querySelector('.body');
        var rtlHtml = '<div dir="rtl" style="text-align:right">' + body.innerHTML + '</div>';
        var plain = body.innerText;
        var done = function () { ping('copy'); c.textContent = 'הועתק ✓'; };
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([rtlHtml], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          })]).then(done).catch(function () { navigator.clipboard.writeText(plain).then(done); });
        } else { navigator.clipboard.writeText(plain).then(done); }
      });
    })();
  </script>
</body>
</html>`
}
```

- [ ] **Step 6: Update `share-publisher` to populate the new fields + pass apiBaseUrl**

In `server/services/share-publisher.ts`, the `view` object currently sets `recipientNames`. Add the address fields, and pass `apiBaseUrl` into `renderShareHtml`. Change the `view` construction to also include:

```ts
      toAddresses: letter.toAddresses as LetterAddress[],
      ccAddresses: letter.ccAddresses as LetterAddress[],
      bccAddresses: letter.bccAddresses as LetterAddress[],
```

and change the `renderShareHtml` call from:

```ts
    const { publicBaseUrl, appBaseUrl } = getShareConfig()
    const html = renderShareHtml(view, { shareBaseUrl: publicBaseUrl, appBaseUrl })
```

to:

```ts
    const { publicBaseUrl, appBaseUrl, apiBaseUrl } = getShareConfig()
    const html = renderShareHtml(view, { shareBaseUrl: publicBaseUrl, appBaseUrl, apiBaseUrl })
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run tests/server/share-renderer.test.ts tests/server/share-publisher.test.ts tests/server/share-config.test.ts`
Expected: PASS (send-page assertions green; publisher/config still green).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add server/services/share-renderer.ts server/services/share-config.ts server/services/share-publisher.ts tests/server/share-renderer.test.ts
git commit -m "feat(share): public send page with mailto/Gmail/copy + sendBeacon tracking"
```

---

### Task 4: Admin member-vs-public sends grouping

**Files:**
- Create: `src/lib/letter-sends.ts` (pure split helper)
- Modify: `src/pages/AdminLettersPage.tsx` (render the split in the Sends column)
- Test: `tests/unit/letter-sends.test.ts`

**Interfaces:**
- Produces: `splitSends(breakdown: Record<string, number>): { member: number; public: number; total: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/letter-sends.test.ts
import { describe, it, expect } from 'vitest'
import { splitSends } from '@/lib/letter-sends'

describe('splitSends', () => {
  it('sums member vs public buckets', () => {
    expect(splitSends({ mailto: 3, copy: 2, public_mailto: 5, public_gmail: 1, public_copy: 4 }))
      .toEqual({ member: 5, public: 10, total: 15 })
  })
  it('handles missing buckets', () => {
    expect(splitSends({ public_mailto: 2 })).toEqual({ member: 0, public: 2, total: 2 })
    expect(splitSends({})).toEqual({ member: 0, public: 0, total: 0 })
  })
})
```

- [ ] **Step 2: Run it — verify RED**

Run: `npx vitest run tests/unit/letter-sends.test.ts`
Expected: FAIL — cannot find module `@/lib/letter-sends`.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/letter-sends.ts
/** Split a letter's send breakdown into member (in-app) vs public (shared-page) totals. */
export function splitSends(breakdown: Record<string, number>): { member: number; public: number; total: number } {
  const n = (k: string) => breakdown[k] ?? 0
  const member = n('mailto') + n('copy')
  const pub = n('public_mailto') + n('public_gmail') + n('public_copy')
  return { member, public: pub, total: member + pub }
}
```

- [ ] **Step 4: Run it — verify GREEN**

Run: `npx vitest run tests/unit/letter-sends.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Render the split in the admin table**

In `src/pages/AdminLettersPage.tsx`, add the import:

```ts
import { splitSends } from '@/lib/letter-sends'
```

Replace the Sends cell:

```tsx
                    <td className="py-2 pr-4">{letter.totalSends}</td>
```

with:

```tsx
                    <td className="py-2 pr-4">
                      {(() => { const s = splitSends(letter.breakdown); return (
                        <span title={`${s.member} member · ${s.public} public`}>
                          {s.total} <span className="text-xs text-muted-foreground">({s.public} public)</span>
                        </span>
                      ) })()}
                    </td>
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/lib/letter-sends.ts src/pages/AdminLettersPage.tsx tests/unit/letter-sends.test.ts
git commit -m "feat(admin): show public vs member send split per letter"
```

---

### Task 5: Docs + full gate

**Files:**
- Modify: `CLAUDE.md` (API table), `docs/architecture.md`

- [ ] **Step 1: Document the new endpoint + page**

In `CLAUDE.md`, add a row to the Backend API table:

```
| `POST`   | `/api/public/letters/:id/send` | **Public, no-auth.** Fire-and-forget send counter for the public share/send pages; records `public_*` analytics buckets (gated by `lettersEnabled` + letter published). |
```

In `docs/architecture.md`, under the share/R2 section, note: the R2 `letter/{id}.html` page is now a **public send surface** (mailto/Gmail/copy, no login), the OG card reorders Hebrew to visual order via `bidi-js` (satori has no bidi), and public sends are tracked via `sendBeacon` → `/api/public/letters/:id/send` into `public_*` buckets, shown split from member sends in the admin dashboard.

- [ ] **Step 2: Full gate**

Run: `npm test` → all pass (prior + new bidi/public-route/send-page/split tests).
Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → 0 errors (pre-existing warnings acceptable).
Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/architecture.md
git commit -m "docs(share): public send pages + public send-tracking endpoint"
```

---

## Operator note (post-merge)
- The feature is gated by the existing `publicSharePages` flag (already on in prod). Sharing a published letter's `…/letter/{id}.png` for the preview and `…/letter/{id}.html` for the send page.
- Optional: set `API_PUBLIC_URL` on Render if the backend URL ever differs from `https://liberal-page.onrender.com` (the default the tracking beacon targets).
