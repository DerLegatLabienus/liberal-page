# SMS/WhatsApp letter shareability & sendability fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SMS/WhatsApp letters usable: show each channel's message body, add a per-letter "copy share link" button, and stop letters from being published with dead (zero-recipient) channels.

**Architecture:** Three independent fixes on the existing multi-channel letters feature. (1) Render `ChannelSend.bodyText` as visible content in both the React detail page and the R2 share HTML. (2) Server computes a `shareUrl` per letter (only when a share page actually exists) and the admin table copies it. (3) Composer + admin route reject publishing a letter with an enabled channel that has no recipients.

**Tech Stack:** React 18 + Vite, Express + Drizzle, Vitest (happy-dom components, node/pglite server), i18next (Hebrew-first RTL).

## Global Constraints

- **Keep the `letters` name.** SMS/WhatsApp are `sms:`/`wa.me` deep links (no backend sender). Recipients are `contact_id[]` resolved live.
- **Hebrew-first, RTL.** UI copy is Hebrew (the letters UI has no i18n — hardcoded Hebrew, matching the existing pattern; do NOT add `t()`/locale keys).
- **Server code is NOT gate-typechecked** (`npx tsc --noEmit` is a no-op; `npm run build`/`tsc -b` covers only the frontend). The **vitest server suite is the only server safety net** — run `npx vitest run tests/server/` green for any server task.
- **Gate:** `npm test` && `npx tsc --noEmit` && `npm run lint` && `npm run build` — all pass.
- **Commit per task; DO NOT push** (controller pushes once at the end after the whole-branch review + gate — this deploy also needs a share-page regeneration, handled in the runbook).
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UPPKuAwc48W6D5uVucwx1A
  ```
- Spec: `docs/superpowers/specs/2026-07-18-sms-whatsapp-shareability-fixes-design.md`.

## File Structure

**Modified:**
- `server/routes/admin-letters.ts` — add `shareUrl` to the list response (Task 1); reject publishing a zero-recipient enabled channel (Task 2).
- `src/types.ts` — `LetterWithStats.shareUrl: string | null` (Task 1).
- `server/services/share-renderer.ts` — render SMS/WhatsApp `body_text` (Task 3).
- `src/pages/LetterDetailPage.tsx` — render SMS/WhatsApp `body_text` (Task 4).
- `src/pages/AdminLettersPage.tsx` — copy-share-link button (Task 5); composer empty-picker note + publish block (Task 6).
- `tests/server/*`, `tests/components/*` — per task.

**No new files, no schema change, no new endpoints.**

---

### Task 1: Server — `shareUrl` on the admin letters list

**Files:**
- Modify: `src/types.ts` (`LetterWithStats`)
- Modify: `server/routes/admin-letters.ts` (list handler, ~line 20)
- Test: `tests/server/admin-letters-shareurl.test.ts` (new)

**Interfaces:**
- Consumes: `getShareConfig().publicBaseUrl` and `isShareConfigured()` from `server/services/share-config.ts` (both already exported).
- Produces: each letter in `GET /api/admin/letters` carries `shareUrl: string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/admin-letters-shareurl.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { db } from '../../server/db/client'
import { letters } from '../../server/db/schema'
// Reuse the exact app + admin-token bootstrap used by tests/server/admin-letters-share-hook.test.ts.
// (Read that file and mirror how it builds the app and an admin bearer token.)
import { buildAdminApp, adminToken } from './helpers/admin-app' // <- replace with the real helpers that file uses

describe('GET /api/admin/letters shareUrl', () => {
  beforeEach(async () => { await db.delete(letters) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('published letter with R2 + publicBaseUrl configured → shareUrl; draft → null', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'a'); vi.stubEnv('R2_ACCESS_KEY_ID', 'b')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'c'); vi.stubEnv('R2_BUCKET', 'd')
    vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://cdn.example')
    const [pub] = await db.insert(letters).values({ title: 'P', status: 'published', priority: 'normal', publishedAt: new Date() }).returning()
    const [draft] = await db.insert(letters).values({ title: 'D', status: 'draft', priority: 'normal' }).returning()

    const { app, token } = await buildAdminApp() // mirror the real bootstrap
    const res = await request(app).get('/api/admin/letters').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const byId = Object.fromEntries(res.body.letters.map((l: { id: number; shareUrl: string | null }) => [l.id, l.shareUrl]))
    expect(byId[pub.id]).toBe(`https://cdn.example/letter/${pub.id}.html`)
    expect(byId[draft.id]).toBeNull()
  })

  it('published but R2 unconfigured → shareUrl null', async () => {
    vi.stubEnv('R2_PUBLIC_BASE_URL', ''); vi.stubEnv('R2_ACCOUNT_ID', '')
    const [pub] = await db.insert(letters).values({ title: 'P', status: 'published', priority: 'normal', publishedAt: new Date() }).returning()
    const { app, token } = await buildAdminApp()
    const res = await request(app).get('/api/admin/letters').set('Authorization', `Bearer ${token}`)
    expect(res.body.letters.find((l: { id: number }) => l.id === pub.id).shareUrl).toBeNull()
  })
})
```

> Before running: open `tests/server/admin-letters-share-hook.test.ts` and copy its real app/token setup (this repo has **no** `server/app.ts`; tests mount the router on a bare express app and mint an admin token via a helper). Replace the `buildAdminApp`/`adminToken` placeholders with that exact pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-letters-shareurl.test.ts`
Expected: FAIL — `shareUrl` is `undefined` on the returned letters.

- [ ] **Step 3: Implement**

In `src/types.ts`, add to `LetterWithStats`:
```ts
shareUrl: string | null
```

In `server/routes/admin-letters.ts`, add the import:
```ts
import { getShareConfig, isShareConfigured } from '../services/share-config'
```
and in the list handler, compute `shareUrl` per letter inside the `withStats` map:
```ts
const shareBase = isShareConfigured() ? getShareConfig().publicBaseUrl : ''
const withStats = withChannels.map((letter) => {
  const stats = statsById.get(letter.id)
  const shareUrl = shareBase && letter.status === 'published' ? `${shareBase}/letter/${letter.id}.html` : null
  return { ...letter, totalSends: stats?.total ?? 0, breakdown: stats?.breakdown ?? {}, shareUrl }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/admin-letters-shareurl.test.ts` → PASS.
Then run the full server suite: `npx vitest run tests/server/` → all green (baseline 528+).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts server/routes/admin-letters.ts tests/server/admin-letters-shareurl.test.ts
git commit -m "feat(letters): expose per-letter shareUrl on the admin list"
```

---

### Task 2: Server — block publishing a zero-recipient enabled channel

**Files:**
- Modify: `server/routes/admin-letters.ts` (POST and PUT handlers)
- Test: `tests/server/admin-letters-publish-guard.test.ts` (new)

**Interfaces:**
- Consumes: the request `channels: LetterChannelInput[]` and `status`.
- Produces: `400 { error: 'Cannot publish: channel "<kind>" has no recipients' }` when publishing with an enabled channel whose `recipientIds` is empty. Draft saves are unaffected.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/admin-letters-publish-guard.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { db } from '../../server/db/client'
import { letters, letterChannels } from '../../server/db/schema'
import { buildAdminApp } from './helpers/admin-app' // mirror admin-letters-share-hook.test.ts bootstrap

describe('POST /api/admin/letters publish guard', () => {
  beforeEach(async () => { await db.delete(letterChannels); await db.delete(letters) })

  it('publishing with an enabled sms channel that has 0 recipients → 400', async () => {
    const { app, token } = await buildAdminApp()
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sms/)
    expect(await db.select().from(letters)).toHaveLength(0) // nothing persisted
  })

  it('same letter as a DRAFT → allowed (201)', async () => {
    const { app, token } = await buildAdminApp()
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'draft', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(201)
  })

  it('publishing with recipients present → allowed', async () => {
    const { app, token } = await buildAdminApp()
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', recipientIds: [1], bodyText: 'hi' }] })
    expect(res.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/admin-letters-publish-guard.test.ts`
Expected: FAIL — the empty-channel publish returns 201, not 400.

- [ ] **Step 3: Implement**

In `server/routes/admin-letters.ts`, add a shared guard helper near the top:
```ts
import type { LetterChannelInput } from '../../src/types'

/** When publishing, every enabled channel must have at least one recipient. Returns an error string or null. */
function publishGuard(status: string | undefined, channels: LetterChannelInput[] | undefined): string | null {
  if (status !== 'published' || !channels) return null
  for (const ch of channels) {
    if ((ch.enabled ?? true) && (ch.recipientIds?.length ?? 0) === 0) {
      return `Cannot publish: channel "${ch.kind}" has no recipients`
    }
  }
  return null
}
```
In the **POST** handler, before creating: `const guard = publishGuard(body.status, body.channels); if (guard) return res.status(400).json({ error: guard })`.
In the **PUT** handler, apply the same guard against the incoming `status`/`channels` before persisting. (For PUT, only enforce when the request actually sets `status: 'published'` and includes `channels`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/admin-letters-publish-guard.test.ts` → PASS.
Full server suite: `npx vitest run tests/server/` → green.

- [ ] **Step 5: Commit**

```bash
git add server/routes/admin-letters.ts tests/server/admin-letters-publish-guard.test.ts
git commit -m "feat(letters): reject publishing a letter with a zero-recipient enabled channel"
```

---

### Task 3: Server — share page shows the SMS/WhatsApp message body

**Files:**
- Modify: `server/services/share-renderer.ts`
- Test: extend `tests/server/share-renderer-content.test.ts`

**Interfaces:**
- Consumes: the SMS/WhatsApp `ShareChannelBlock` (which already carries the channel's `bodyText` and its recipient links — confirm the field name by reading `share-renderer.ts`; the block was added in the 2026-07-15 feature).
- Produces: the rendered HTML shows the channel's message text as a visible block above its recipient links.

- [ ] **Step 1: Write the failing test**

Read `tests/server/share-renderer-content.test.ts` first. Extend the SMS case to assert the message text itself appears in the HTML as content (not only inside the `sms:`/`wa.me` href). Concretely, for a `ShareLetterView` whose SMS block has `bodyText: 'הודעת בדיקה לשיתוף'`, assert:
```ts
expect(html).toContain('הודעת בדיקה לשיתוף') // visible message body, outside any href attribute
```
Add the same assertion for a WhatsApp block. (If the existing fixtures already put the body only in the URL, this will fail until Step 3.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/share-renderer-content.test.ts`
Expected: FAIL — the body text is only present percent-encoded inside the href, not as readable content.

- [ ] **Step 3: Implement**

In `server/services/share-renderer.ts`, find where each SMS/WhatsApp `ShareChannelBlock` renders its recipient link list. Above that list, emit the message body as an escaped block, e.g.:
```ts
`<div class="body">${esc(block.bodyText)}</div>`
```
Reuse the existing `esc()` text-escaper (already used for the email body). Match the existing markup/classes used by the email block so styling is consistent. Do not alter the recipient links or their beacons.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/share-renderer-content.test.ts` → PASS.
Full server suite → green.

- [ ] **Step 5: Commit**

```bash
git add server/services/share-renderer.ts tests/server/share-renderer-content.test.ts
git commit -m "feat(letters): show SMS/WhatsApp message body on the share page"
```

---

### Task 4: Frontend — detail page shows the SMS/WhatsApp message body

**Files:**
- Modify: `src/pages/LetterDetailPage.tsx`
- Test: `tests/components/LetterDetailPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `ChannelSend.bodyText` (already on the type).
- Produces: for sms/whatsapp channels, the message text renders as a visible block above the per-recipient buttons.

- [ ] **Step 1: Write the failing test**

Extend `tests/components/LetterDetailPage.test.tsx`: in the mocked detail response, give the sms channel `bodyText: 'תוכן ההודעה'`. Assert it renders:
```tsx
expect(screen.getByText('תוכן ההודעה')).toBeInTheDocument()
```
(The existing test already mocks the detail call + renders per-recipient buttons; this adds the body assertion.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/LetterDetailPage.test.tsx`
Expected: FAIL — the body text isn't rendered (only buttons are).

- [ ] **Step 3: Implement**

In `src/pages/LetterDetailPage.tsx`, in the sms/whatsapp branch (the `<div className="space-y-2">` block that maps `channel.recipients` to buttons), render the body above the buttons:
```tsx
<div className="space-y-2">
  {channel.bodyText && (
    <p className="whitespace-pre-wrap rounded border border-border bg-muted/40 p-3 text-sm">{channel.bodyText}</p>
  )}
  {/* existing per-recipient buttons map stays below */}
</div>
```
(Use classes consistent with the page's existing card styling.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/LetterDetailPage.test.tsx` → PASS.
Confirm frontend build clean: `npm run build 2>&1 | grep -n "LetterDetailPage.tsx"` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LetterDetailPage.tsx tests/components/LetterDetailPage.test.tsx
git commit -m "feat(letters): show SMS/WhatsApp message body on the detail page"
```

---

### Task 5: Frontend — "Copy share link" button in the admin table

**Files:**
- Modify: `src/types.ts` is already done in Task 1 (`LetterWithStats.shareUrl`); no change here.
- Modify: `src/lib/api-client.ts` (the `LetterWithStats` returned by `admin.letters.list` already carries `shareUrl` via the type — verify no explicit narrower type strips it).
- Modify: `src/pages/AdminLettersPage.tsx` (letters table row Actions cell)
- Test: `tests/components/AdminLettersComposer.test.tsx` (extend) or the admin-table test if one exists

**Interfaces:**
- Consumes: `letter.shareUrl` on each `LetterWithStats` row.
- Produces: a "העתקת קישור שיתוף" button per row when `shareUrl` is non-null; copies to clipboard with a transient "✓" confirmation.

- [ ] **Step 1: Write the failing test**

Extend the admin letters component test. Mock `api.admin.letters.list` to return two rows: one with `shareUrl: 'https://cdn.example/letter/6.html'`, one with `shareUrl: null`. Assert:
- the row WITH a shareUrl renders a button named `/קישור שיתוף/`; clicking it calls `navigator.clipboard.writeText` with that URL (spy on `navigator.clipboard.writeText`);
- the row WITHOUT a shareUrl renders no such button.

```tsx
const writeText = vi.fn().mockResolvedValue(undefined)
Object.assign(navigator, { clipboard: { writeText } })
// ...render, then:
await userEvent.click(screen.getByRole('button', { name: /קישור שיתוף/ }))
expect(writeText).toHaveBeenCalledWith('https://cdn.example/letter/6.html')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: FAIL — no copy-share-link button exists.

- [ ] **Step 3: Implement**

In `src/pages/AdminLettersPage.tsx`, in the letters table row's Actions cell (where Edit/Delete/Pin buttons are), add — only when `letter.shareUrl`:
```tsx
{letter.shareUrl && (
  <CopyShareLink url={letter.shareUrl} />
)}
```
and a small local component:
```tsx
function CopyShareLink({ url }: { url: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(url) } catch { /* clipboard blocked */ } setDone(true); setTimeout(() => setDone(false), 1500) }}
      className="text-xs font-medium text-muted-foreground hover:text-primary"
      title={url}
    >
      {done ? '✓ הועתק' : 'העתקת קישור שיתוף'}
    </button>
  )
}
```
(Match the existing row-action button styling; `useState` is already imported in the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx` → PASS.
`npm run build 2>&1 | grep -n "AdminLettersPage.tsx"` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "feat(letters): copy-share-link button in the admin letters table"
```

---

### Task 6: Frontend — composer empty-picker note + block publish

**Files:**
- Modify: `src/pages/AdminLettersPage.tsx` (`ChannelBodyTab` + the submit/publish path)
- Test: `tests/components/AdminLettersComposer.test.tsx` (extend)

**Interfaces:**
- Consumes: the per-channel candidate contact lists (`smsContacts`/`waContacts`) and selected `ids`, already in the composer.
- Produces: (a) an inline note in a channel tab when its candidate list is empty; (b) publishing is prevented (with a message) when an enabled channel has zero selected recipients — save-as-draft still works.

- [ ] **Step 1: Write the failing test**

Extend the composer test with two cases:
1. Enable the WhatsApp channel with an **empty** candidate list (mock `api.letters.contacts(_, 'whatsapp')` → `{ contacts: [] }`); assert a note like `/אין אנשי קשר.*וואטסאפ/` renders in the WhatsApp tab.
2. Enable SMS with a body but select **no** recipients, set status to published, click submit; assert `api.admin.letters.create` is **not** called and an error message about the empty channel is shown. Then select a recipient (or switch to draft) and assert submit proceeds.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx`
Expected: FAIL — no note; publish proceeds with an empty channel.

- [ ] **Step 3: Implement**

In `ChannelBodyTab` (`src/pages/AdminLettersPage.tsx` ~line 892), when `contacts.length === 0`, render an inline note above the `RecipientEditor`:
```tsx
{contacts.length === 0 && (
  <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    אין אנשי קשר עם {mode === 'whatsapp' ? 'וואטסאפ' : 'טלפון'} — הוסיפו מספרי טלפון לאנשי הקשר לפני הפעלת הערוץ.
  </p>
)}
```
In the submit handler (where `buildChannels()` is called), before publishing, compute the offending channels and block:
```ts
const built = buildChannels()
if (status === 'published') {
  const empty = built.find((c) => (c.enabled ?? true) && (c.recipientIds?.length ?? 0) === 0)
  if (empty) { setSubmitError(`לא ניתן לפרסם: לערוץ "${empty.kind}" אין נמענים`); return }
}
```
Add a `submitError` state + render it near the submit button (mirror any existing error display in the form). Keep draft submits unaffected.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AdminLettersComposer.test.tsx` → PASS.
`npm run build 2>&1 | grep -n "AdminLettersPage.tsx"` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminLettersPage.tsx tests/components/AdminLettersComposer.test.tsx
git commit -m "feat(letters): composer warns on empty channel + blocks publishing dead channels"
```

---

## Verification (whole feature)

- Full gate green: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- Manual (local or prod-after-deploy, logged in as admin):
  - Open a letter with SMS/WhatsApp channels that have phone recipients → the message body shows under each channel header, with a send button per recipient; clicking opens the app with the message pre-filled.
  - Admin letters table shows "העתקת קישור שיתוף" on published letters; clicking copies `…/letter/{id}.html`.
  - Composer: enabling WhatsApp with no reachable contacts shows the note; trying to publish a letter with a zero-recipient enabled channel is blocked; saving as draft works.

## Deployment runbook

1. Push (controller, after whole-branch review + gate). Frontend + backend deploy.
2. Admin → **Regenerate share pages** so existing published letters' R2 pages pick up the SMS/WhatsApp body rendering (Task 3).
3. Add phone numbers (+ WhatsApp flag) to real MK/official contacts via the contact editor — SMS/WhatsApp only has recipients once contacts have phones.
4. Remove the investigation test data: delete contact id 19 (`בדיקה SMS/WA`) and clear letter 6's SMS/WhatsApp `recipient_ids` (via the Neon MCP), or just delete/rebuild "Testing wa".

## Self-Review notes (spec coverage)

- Part 1 (show body) → Task 3 (share) + Task 4 (detail). ✅
- Part 2 (copy share link) → Task 1 (server shareUrl) + Task 5 (button). ✅
- Part 3 (guardrail) → Task 2 (server publish block) + Task 6 (composer note + client block). ✅
- Out of scope (phone data entry, recipient-less model, frontend R2 env) → not implemented, by design. ✅
