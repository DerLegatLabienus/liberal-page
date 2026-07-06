# Turnstile-Gated Public Letter Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the public letter share pages behind a Cloudflare Turnstile interstitial and verify the token server-side before a public send is counted.

**Architecture:** The static R2 share page hides the letter until a Turnstile *Managed* widget passes (client-side wall). Every send carries the token to `POST /api/public/letters/:id/send`, which verifies it via Cloudflare `siteverify` before recording — the server check is the real integrity gate. Gated by the `publicSendTurnstile` flag; fail-open on misconfig.

**Tech Stack:** Express 5 + tsx, Node 22 global `fetch`, Drizzle/Postgres (pglite in tests), satori/R2 (unchanged), Vitest + supertest.

**Design doc:** `docs/superpowers/specs/2026-07-06-turnstile-public-send-design.md`

## Global Constraints

- The **server `siteverify` is the only real integrity gate**; the interstitial wall is client-side UX and must never be the sole protection.
- The endpoint **always returns `204`** (uniform, no information leak) — unchanged.
- **Fail-open on misconfig:** `TURNSTILE_SECRET_KEY` unset → verification returns `skip` → the send is still counted, and a warning is logged.
- **Flag off (`publicSendTurnstile` = false, the default) → current behavior:** count without any verification.
- The **wall is baked only when `TURNSTILE_SITE_KEY` is non-empty**; empty → pages render exactly as today (content visible, no widget).
- Widget mode is **Managed** (Cloudflare default — no explicit mode attribute needed).
- Token travels in the **beacon body as text/plain** (a "simple" request → no CORS preflight); `action` stays in the query string.
- The **member (logged-in) send path is untouched** — only `server/routes/public-letters.ts` and the public share page change.
- The flag migration is an **idempotent `INSERT ... ON CONFLICT DO NOTHING` into `"config"."feature_flags"`**, default `false`.

---

### Task 1: `verifyTurnstile` service

**Files:**
- Create: `server/services/turnstile.ts`
- Test: `tests/server/turnstile.test.ts`

**Interfaces:**
- Produces: `verifyTurnstile(token: string, remoteip?: string): Promise<'verified' | 'rejected' | 'skip'>` and `type TurnstileResult`.

- [ ] **Step 1: Write the failing test** (`tests/server/turnstile.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyTurnstile } from '../../server/services/turnstile'

describe('verifyTurnstile', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('returns "skip" (no network) when the secret is unset', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await verifyTurnstile('tok')).toBe('skip')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns "rejected" for an empty token without calling siteverify', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await verifyTurnstile('')).toBe('rejected')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns "verified" when siteverify reports success', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }))
    expect(await verifyTurnstile('tok')).toBe('verified')
  })

  it('returns "rejected" when siteverify reports failure', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }))
    expect(await verifyTurnstile('tok')).toBe('rejected')
  })

  it('returns "rejected" on a non-200 or a thrown fetch', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    expect(await verifyTurnstile('tok')).toBe('rejected')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    expect(await verifyTurnstile('tok')).toBe('rejected')
  })
})
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run tests/server/turnstile.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** (`server/services/turnstile.ts`)

```ts
export type TurnstileResult = 'verified' | 'rejected' | 'skip'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Verify a Turnstile token via Cloudflare siteverify.
 *  Returns 'skip' when the secret is unconfigured so the caller can fail open
 *  on misconfiguration rather than silently zeroing the send metric. */
export async function verifyTurnstile(token: string, remoteip?: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    console.warn('[turnstile] TURNSTILE_SECRET_KEY unset — skipping verification (fail-open)')
    return 'skip'
  }
  if (!token) return 'rejected'
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (remoteip) body.set('remoteip', remoteip)
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body })
    if (!res.ok) return 'rejected'
    const data = (await res.json()) as { success?: boolean }
    return data.success === true ? 'verified' : 'rejected'
  } catch (err) {
    console.error('[turnstile] siteverify failed:', err)
    return 'rejected'
  }
}
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run tests/server/turnstile.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(turnstile): siteverify service with fail-open skip on missing secret`

---

### Task 2: Bake the interstitial wall into the share page

**Files:**
- Modify: `server/services/share-config.ts` (add `turnstileSiteKey`)
- Modify: `server/services/share-renderer.ts` (`renderShareHtml` — optional wall)
- Modify: `server/services/share-publisher.ts` (pass sitekey through)
- Test: `tests/server/share-renderer.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `renderShareHtml(view, opts)` where `opts` gains optional `turnstileSiteKey?: string`. When non-empty the HTML contains the Turnstile script, a `.cf-turnstile` widget bound to the sitekey, the letter content in a `hidden` `#letter-content` container, reveal/error callbacks, and a `#gate-fallback` link. When empty/absent, output is unchanged from today.

- [ ] **Step 1: Write the failing tests** — append to `tests/server/share-renderer.test.ts`:

```ts
describe('renderShareHtml (Turnstile interstitial)', () => {
  const base = {
    id: 9, title: 'חוק', subject: 'נ', bodyHtml: '<p>גוף</p>', bodyPlain: 'גוף',
    recipientNames: ['ח"כ'], issueTags: ['בריאות'],
    toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ' }], ccAddresses: [], bccAddresses: [],
  }
  const optsBase = { shareBaseUrl: 'https://pub.r2.dev', appBaseUrl: 'https://app', apiBaseUrl: 'https://api' }

  it('bakes the widget + hidden content when a sitekey is provided', () => {
    const html = renderShareHtml(base, { ...optsBase, turnstileSiteKey: '0xSITEKEY' })
    expect(html).toContain('challenges.cloudflare.com/turnstile/v0/api.js')
    expect(html).toContain('data-sitekey="0xSITEKEY"')
    expect(html).toContain('id="letter-content" hidden')
    expect(html).toContain('id="gate-fallback"')            // fallback escape hatch
    expect(html).toContain('turnstile.getResponse')          // token read at send time
  })

  it('renders no wall and visible content when the sitekey is absent (unchanged)', () => {
    const html = renderShareHtml(base, optsBase)
    expect(html).not.toContain('cf-turnstile')
    expect(html).not.toContain('turnstile/v0/api.js')
    expect(html).toContain('id="letter-content"')            // present but NOT hidden
    expect(html).not.toContain('id="letter-content" hidden')
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/server/share-renderer.test.ts` → FAIL.

- [ ] **Step 3a: `share-config.ts`** — add the field:

```ts
// in interface ShareConfig:
turnstileSiteKey: string
// in getShareConfig() return object:
turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? '',
```

- [ ] **Step 3b: `share-renderer.ts`** — extend `renderShareHtml`:

Add `turnstileSiteKey?: string` to the `opts` param type. Then inside:

```ts
const siteKey = opts.turnstileSiteKey ?? ''
const gated = siteKey !== ''
const hiddenAttr = gated ? ' hidden' : ''
const turnstileScript = gated
  ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
  : ''
const gateCallbacks = gated
  ? `<script>function tsSolved(){var c=document.getElementById('letter-content');if(c)c.removeAttribute('hidden');var g=document.getElementById('gate');if(g)g.setAttribute('hidden','');}function tsError(){var f=document.getElementById('gate-fallback');if(f)f.removeAttribute('hidden');}</script>`
  : ''
const gateBlock = gated
  ? `<div id="gate">
       <p class="note">${'לפני הצפייה, אנא אשרו שאינכם רובוט.'}</p>
       <div class="cf-turnstile" data-sitekey="${escAttr(siteKey)}" data-callback="tsSolved" data-error-callback="tsError" data-timeout-callback="tsError"></div>
     </div>
     <div id="gate-fallback" hidden><a class="learn" href="${learnMoreUrl}">${'לצפייה במכתב באתר ←'}</a></div>`
  : ''
```

Wrap the existing card inner content (tags/title/to/body/actions) in
`<div id="letter-content"${hiddenAttr}> … </div>`, place `${gateBlock}` **before**
it inside `.card`, add `${gateCallbacks}` in `<head>` (before other scripts) and
`${turnstileScript}` in `<head>`.

In the inline send IIFE, read the live token and pass it as the beacon body
(works with or without Turnstile present):

```js
function ping(action){ try { var t=(window.turnstile&&turnstile.getResponse())||''; navigator.sendBeacon(track + '?action=' + action, t); } catch(e){} }
```

(The copy handler calls the same `ping('copy')` — unchanged.)

- [ ] **Step 3c: `share-publisher.ts`** — pass the sitekey through:

```ts
const { publicBaseUrl, appBaseUrl, apiBaseUrl, turnstileSiteKey } = getShareConfig()
const html = renderShareHtml(view, { shareBaseUrl: publicBaseUrl, appBaseUrl, apiBaseUrl, turnstileSiteKey })
```

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run tests/server/share-renderer.test.ts` → PASS (new + existing).
- [ ] **Step 5: Commit** — `feat(share): Turnstile interstitial wall on public letter pages (sitekey-gated)`

---

### Task 3: Enforce Turnstile at the public send endpoint

**Files:**
- Modify: `server/routes/public-letters.ts`
- Test: `tests/server/public-letters-route.test.ts` (extend)

**Interfaces:**
- Consumes: `verifyTurnstile` from Task 1; reads the `publicSendTurnstile` flag.

- [ ] **Step 1: Write the failing tests** — extend `tests/server/public-letters-route.test.ts`.

At the top of the file, mock the service:

```ts
import { verifyTurnstile } from '../../server/services/turnstile'
vi.mock('../../server/services/turnstile', () => ({ verifyTurnstile: vi.fn() }))
const mockedVerify = vi.mocked(verifyTurnstile)
```

Add a nested describe (token sent via `.set('Content-Type','text/plain').send('tok')`):

```ts
describe('with publicSendTurnstile enforcement', () => {
  beforeEach(async () => { await flags.setFlag('publicSendTurnstile', true, 'True', 'x'); mockedVerify.mockReset() })

  it('records when the token verifies', async () => {
    mockedVerify.mockResolvedValue('verified')
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`).set('Content-Type','text/plain').send('tok')
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_mailto).toBe(1)
  })

  it('does NOT record when the token is rejected', async () => {
    mockedVerify.mockResolvedValue('rejected')
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`).set('Content-Type','text/plain').send('bad')
    expect(res.status).toBe(204)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  it('records (fail-open) when verification is skipped (secret unset)', async () => {
    mockedVerify.mockResolvedValue('skip')
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=copy`).set('Content-Type','text/plain').send('')
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_copy).toBe(1)
  })

  it('does not verify at all when the flag is off (regression)', async () => {
    await flags.setFlag('publicSendTurnstile', false, 'False', 'x')
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`)
    await flush()
    expect(mockedVerify).not.toHaveBeenCalled()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_mailto).toBe(1)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/server/public-letters-route.test.ts` → FAIL.

- [ ] **Step 3: Implement** (`server/routes/public-letters.ts`)

- Change the import to `import express, { Router } from 'express'` and add `import { verifyTurnstile } from '../services/turnstile'`.
- Add `express.text` body parsing as **per-route** middleware so the mounted router is self-contained:
  `router.post('/:id/send', express.text({ type: '*/*', limit: '4kb' }), async (req, res) => { … })`
- After the throttle check, read the flag and token, and guard recording:

```ts
const enforce = await flagsRepo.isEnabled('publicSendTurnstile')
const token = typeof req.body === 'string' ? req.body : ''
setImmediate(async () => {
  try {
    if (enforce) {
      const result = await verifyTurnstile(token, ip)
      if (result === 'rejected') return           // human not confirmed → do not count
    }
    await analyticsRepo.record(id, BUCKET[action])
    await lettersRepo.incrementActivityScore(id)
  } catch (err) {
    console.error('[public-letters] record failed:', err)
  }
})
res.status(204).end()
```

(`verified` and `skip` both fall through to recording; only `rejected` returns early.)

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run tests/server/public-letters-route.test.ts` → PASS (new + all existing, incl. CORS + flag-off).
- [ ] **Step 5: Commit** — `feat(public-letters): verify Turnstile before counting sends (flag-gated, fail-open)`

---

### Task 4: Seed the `publicSendTurnstile` flag + document env

**Files:**
- Create: `server/db/migrations/0024_public_send_turnstile_flag.sql`
- Modify: `server/db/migrations/meta/_journal.json`
- Modify: `.env.example`

**Interfaces:** none (data + docs).

- [ ] **Step 1: Create the migration** (`0024_public_send_turnstile_flag.sql`)

```sql
-- Seed the publicSendTurnstile feature flag (default off): gates server-side
-- Cloudflare Turnstile verification of public letter sends. Idempotent.
INSERT INTO "config"."feature_flags" ("name", "enabled", "value", "description", "updated_at")
VALUES ('publicSendTurnstile', false, NULL, 'Verify Cloudflare Turnstile before counting public letter sends', now())
ON CONFLICT ("name") DO NOTHING;
```

- [ ] **Step 2: Register it in the journal** — append to the `entries` array in `server/db/migrations/meta/_journal.json` (after idx 23):

```json
    {
      "idx": 24,
      "version": "7",
      "when": 1783075000000,
      "tag": "0024_public_send_turnstile_flag",
      "breakpoints": true
    }
```

(`when` only needs to be ≥ the previous entry; the value above satisfies that.)

- [ ] **Step 3: Update `.env.example`** — add under the R2 block:

```
# Cloudflare Turnstile — public letter send-page bot gate (publicSendTurnstile flag).
# Create a Managed widget in the Cloudflare dashboard (same account as R2), with the
# R2 public hostname (pub-<hash>.r2.dev) in its allowed hostnames.
# TURNSTILE_SITE_KEY is public (baked into the static share page HTML at generation).
# TURNSTILE_SECRET_KEY is server-side only (used for siteverify). Unset = verification
# is skipped (sends still counted). Local test pair: 1x00000000000000000000AA /
# 1x0000000000000000000000000000000AA (always passes).
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

- [ ] **Step 4: Verify migration applies** — run the full suite (`npm test`); the test harness replays migrations onto pglite, so a green suite confirms `0024` parses and applies. Optionally `npx vitest run tests/server/public-letters-route.test.ts`.
- [ ] **Step 5: Commit** — `feat(db): seed publicSendTurnstile feature flag (default off) + document Turnstile env`

---

## Post-implementation (controller, after all tasks pass review)

1. Run the full gate: `npm run lint && npm run build && npm test`.
2. Push to `master` (deploys). The flag is **off** by default, so nothing changes for visitors yet.
3. **Enable in production** (owner-driven, ordered): confirm `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` are set on Render → turn on the `publicSendTurnstile` flag in the admin panel → **regenerate the share pages** so the wall is baked in: `npm run letters:regen` (with the R2 env supplied) or by re-publishing letters.
4. Smoke-test: open a `letter/{id}.html` — the widget should appear and the letter reveal after it passes; a send should still record in the `public_*` buckets.

## Self-review notes

- Spec coverage: turnstile service (T1), interstitial wall + config + publisher (T2), server enforcement + flag gate + fail-open (T3), flag seed + env docs (T4) — all spec sections mapped.
- Type consistency: `TurnstileResult` union used identically in T1 and T3; `turnstileSiteKey` optional in the renderer (T2) so existing `renderShareHtml` callers/tests compile unchanged.
- No placeholders: all code and the exact migration/journal values are inline.
