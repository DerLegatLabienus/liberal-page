# Knesset Transition Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded `CURRENT_KNESSET = 25` values with a config file + service that auto-detects a new Knesset on startup, marks displaced MKs as inactive, and exposes an admin trigger endpoint.

**Architecture:** A new `knesset-config.ts` service owns the config file (`src/data/knesset-config.json`) and exposes `getCurrentKnesset()` (sync) and `detectKnessetTransition()` (async, OData query). Server startup calls `detectKnessetTransition()` non-blocking. A `POST /api/knesset/transition` endpoint allows manual triggering. The `Mk` type gets `inactive?: boolean`, the poller skips inactive MKs, and `MkCard` renders a grey banner for them.

**Tech Stack:** Express, Knesset OData API, React 18, Vitest, TypeScript, `fs/promises`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/data/knesset-config.json` | Create | Source-controlled config: `{ currentKnesset: 25, detectedAt: "..." }` |
| `server/services/knesset-config.ts` | Create | `getCurrentKnesset()`, `detectKnessetTransition()`, `runTransition()` |
| `server/services/knesset-scraper.ts` | Modify | Replace `CURRENT_KNESSET = 25` const with `getCurrentKnesset()` call |
| `server/routes/bills.ts` | Modify | Replace `CURRENT_KNESSET = 25` const with `getCurrentKnesset()` call |
| `server/routes/committees.ts` | Modify | Replace inline `KnessetNum eq 25` with `getCurrentKnesset()` call |
| `server/services/knesset-members.ts` | Modify | Pass `getCurrentKnesset()` instead of unused `_knessetNum` param |
| `server/routes/knesset.ts` | Create | `POST /api/knesset/transition` admin endpoint |
| `server/index.ts` | Modify | Register `/api/knesset` router; call `detectKnessetTransition()` on startup |
| `src/types.ts` | Modify | Add `inactive?: boolean` to `Mk` interface |
| `server/services/poller.ts` | Modify | Skip MKs where `mk.inactive === true` |
| `src/components/parliament/MkCard.tsx` | Modify | Grey banner + opacity for inactive MKs |
| `tests/server/knesset-config.test.ts` | Create | Unit tests for config service |
| `tests/server/knesset-route.test.ts` | Create | Route tests for transition endpoint |
| `tests/components/MkCard.test.tsx` | Modify | Add test for inactive MK rendering |

---

## Task 1: Config File + `knesset-config.ts` Service

**Files:**
- Create: `src/data/knesset-config.json`
- Create: `server/services/knesset-config.ts`
- Create: `tests/server/knesset-config.test.ts`

- [ ] **Step 1: Create `src/data/knesset-config.json`**

```json
{ "currentKnesset": 25, "detectedAt": "2022-11-01T00:00:00.000Z" }
```

- [ ] **Step 2: Write failing tests**

Create `tests/server/knesset-config.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, writeFile, unlink } from 'fs/promises'

vi.mock('fs/promises')
vi.stubGlobal('fetch', vi.fn())

import { getCurrentKnesset, detectKnessetTransition } from '../../server/services/knesset-config'

function mockOdata(knessetNum: number) {
  return { ok: true, json: async () => ({ value: [{ KnessetNum: knessetNum }] }) } as Response
}

describe('getCurrentKnesset', () => {
  it('returns 25 from the config file', () => {
    expect(getCurrentKnesset()).toBe(25)
  })
})

describe('detectKnessetTransition', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    vi.mocked(writeFile).mockResolvedValue()
    vi.mocked(unlink).mockResolvedValue()
  })
  afterEach(() => vi.clearAllMocks())

  it('returns false when live Knesset matches stored', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(25))
    const result = await detectKnessetTransition()
    expect(result).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('returns true and writes config when live Knesset is higher', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(26))
    // Mock the mks.json read for markInactiveMks
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    // Mock the active MKs OData call
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) } as Response)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) } as Response)
    const result = await detectKnessetTransition()
    expect(result).toBe(true)
    expect(writeFile).toHaveBeenCalled()
    const [, written] = vi.mocked(writeFile).mock.calls[0]
    const config = JSON.parse(written as string)
    expect(config.currentKnesset).toBe(26)
  })

  it('returns false and does not throw when OData fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))
    const result = await detectKnessetTransition()
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 3: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- knesset-config
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `server/services/knesset-config.ts`**

```typescript
import { readFileSync, existsSync } from 'fs'
import { readFile, writeFile, unlink } from 'fs/promises'
import path from 'path'

const CONFIG_PATH = path.join(process.cwd(), 'src/data/knesset-config.json')
const MKS_PATH = path.join(process.cwd(), 'src/data/mks.json')
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

interface KnessetConfig {
  currentKnesset: number
  detectedAt: string
}

// Synchronously read config at module load — used by getCurrentKnesset()
function loadConfig(): KnessetConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as KnessetConfig
  } catch {
    return { currentKnesset: 25, detectedAt: new Date().toISOString() }
  }
}

let config = loadConfig()

export function getCurrentKnesset(): number {
  return config.currentKnesset
}

async function markInactiveMks(newKnesset: number): Promise<void> {
  // Get active SiteIds from OData for the new Knesset
  const [personsRes, siteCodesRes] = await Promise.all([
    fetch(`${ODATA_BASE}/KNS_Person?$filter=IsCurrent%20eq%20true&$select=PersonID&$top=200&$format=json`,
      { headers: { Accept: 'application/json' } }),
    fetch(`${ODATA_BASE}/KNS_MkSiteCode?$filter=KnessetNum%20eq%20${newKnesset}&$select=KnsID,SiteId&$top=200&$format=json`,
      { headers: { Accept: 'application/json' } }),
  ])
  const persons = personsRes.ok ? (await personsRes.json() as { value: Array<{ PersonID: number }> }).value : []
  const siteCodes = siteCodesRes.ok ? (await siteCodesRes.json() as { value: Array<{ KnsID: number; SiteId: number }> }).value : []

  const activePersonIds = new Set(persons.map((p) => p.PersonID))
  const activeSiteIds = new Set(
    siteCodes.filter((sc) => activePersonIds.has(sc.KnsID)).map((sc) => String(sc.SiteId))
  )

  // Read tracked MKs and mark inactive
  let mks: Array<Record<string, unknown>> = []
  try {
    mks = JSON.parse(await readFile(MKS_PATH, 'utf-8')) as Array<Record<string, unknown>>
  } catch { return }

  let changed = false
  for (const mk of mks) {
    const siteId = mk.knesset_site_id as string | undefined
    if (siteId && !activeSiteIds.has(siteId) && !mk.inactive) {
      mk.inactive = true
      changed = true
    }
  }

  if (changed) {
    await writeFile(MKS_PATH, JSON.stringify(mks, null, 2), 'utf-8')
  }
}

export async function runTransition(newKnesset: number): Promise<void> {
  const current = config.currentKnesset
  console.log(`Knesset transition: ${current} → ${newKnesset}`)

  // 1. Update config
  config = { currentKnesset: newKnesset, detectedAt: new Date().toISOString() }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')

  // 2. Clear caches
  const caches = [
    path.join(process.cwd(), 'src/data/knesset-members-cache.json'),
    path.join(process.cwd(), 'src/data/knesset-committees-cache.json'),
  ]
  await Promise.all(caches.map((p) => unlink(p).catch(() => { /* already absent */ })))

  // 3. Mark inactive MKs
  await markInactiveMks(newKnesset).catch((err) => {
    console.error('Failed to mark inactive MKs:', err)
  })
}

export async function detectKnessetTransition(): Promise<boolean> {
  try {
    const res = await fetch(
      `${ODATA_BASE}/KNS_PersonToPosition?$filter=PositionID%20eq%2043%20and%20IsCurrent%20eq%20true&$orderby=KnessetNum%20desc&$top=1&$select=KnessetNum&$format=json`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return false
    const data = await res.json() as { value: Array<{ KnessetNum: number }> }
    const liveKnesset = data.value?.[0]?.KnessetNum
    if (!liveKnesset || liveKnesset <= config.currentKnesset) return false
    await runTransition(liveKnesset)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- knesset-config
```

Expected: 4 tests PASS.

- [ ] **Step 6: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/data/knesset-config.json server/services/knesset-config.ts tests/server/knesset-config.test.ts
git commit -m "feat: add knesset-config.ts service with getCurrentKnesset, detectKnessetTransition, runTransition"
```

---

## Task 2: Replace All 4 Hardcoded `CURRENT_KNESSET = 25` References

**Files:**
- Modify: `server/services/knesset-scraper.ts`
- Modify: `server/routes/bills.ts`
- Modify: `server/routes/committees.ts`
- Modify: `server/services/knesset-members.ts`

- [ ] **Step 1: Update `server/services/knesset-scraper.ts`**

Remove:
```typescript
const CURRENT_KNESSET = 25
```

Add at top after existing imports:
```typescript
import { getCurrentKnesset } from './knesset-config'
```

In `fetchMkActivity`, replace:
```typescript
const url = `${KNESSET_WEBSITE_API}/MKs/GetParlamentayActivity?mkId=${siteId}&knessetId=${CURRENT_KNESSET}`
```
With:
```typescript
const url = `${KNESSET_WEBSITE_API}/MKs/GetParlamentayActivity?mkId=${siteId}&knessetId=${getCurrentKnesset()}`
```

- [ ] **Step 2: Update `server/routes/bills.ts`**

Remove:
```typescript
const CURRENT_KNESSET = 25
```

Add import:
```typescript
import { getCurrentKnesset } from '../services/knesset-config'
```

In the search route, replace:
```typescript
const url = `${ODATA_BASE}/KNS_Bill?$filter=KnessetNum%20eq%20${CURRENT_KNESSET}%20and%20substringof('${encoded}',Name)&$top=20&$select=BillID,Name,StatusID&$format=json`
```
With:
```typescript
const url = `${ODATA_BASE}/KNS_Bill?$filter=KnessetNum%20eq%20${getCurrentKnesset()}%20and%20substringof('${encoded}',Name)&$top=20&$select=BillID,Name,StatusID&$format=json`
```

Also replace in `knessetUrl`:
```typescript
knessetUrl: `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=${b.BillID}`,
```
(No change needed here — bill ID is independent of Knesset number.)

- [ ] **Step 3: Update `server/routes/committees.ts`**

Add import after existing imports:
```typescript
import { getCurrentKnesset } from '../services/knesset-config'
```

In the list route, replace the hardcoded `25` in the OData filter:
```typescript
// Before:
`KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20KnessetNum%20eq%2025&$select=CommitteeID,Name&$top=200&$format=json`
// After:
`KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20KnessetNum%20eq%20${getCurrentKnesset()}&$select=CommitteeID,Name&$top=200&$format=json`
```

- [ ] **Step 4: Update `server/services/knesset-members.ts`**

Add import after existing imports:
```typescript
import { getCurrentKnesset } from './knesset-config'
```

In `fetchAllKnessetMembers`, the `_knessetNum` param is currently unused. Replace the function signature and the two hardcoded `25` references inside the function body. Read the file and find:
- Any reference to `_knessetNum` or hardcoded `25` inside the function — replace with `getCurrentKnesset()`

The function signature changes from:
```typescript
export async function fetchAllKnessetMembers(_knessetNum: number): Promise<KnessetMember[]> {
```
To:
```typescript
export async function fetchAllKnessetMembers(): Promise<KnessetMember[]> {
```

Also update the call site in `server/routes/mks.ts` where `fetchAllKnessetMembers(25)` is called — change to `fetchAllKnessetMembers()`.

- [ ] **Step 5: Run full test suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add server/services/knesset-scraper.ts server/routes/bills.ts server/routes/committees.ts server/services/knesset-members.ts server/routes/mks.ts
git commit -m "feat: replace hardcoded CURRENT_KNESSET=25 with getCurrentKnesset() from config"
```

---

## Task 3: Admin Endpoint `POST /api/knesset/transition`

**Files:**
- Create: `server/routes/knesset.ts`
- Create: `tests/server/knesset-route.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/knesset-route.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../../server/services/knesset-config', () => ({
  getCurrentKnesset: vi.fn().mockReturnValue(25),
  detectKnessetTransition: vi.fn().mockResolvedValue(false),
  runTransition: vi.fn().mockResolvedValue(undefined),
}))

import knessetRouter from '../../server/routes/knesset'
import { detectKnessetTransition, runTransition, getCurrentKnesset } from '../../server/services/knesset-config'

const app = express()
app.use(express.json())
app.use('/api/knesset', knessetRouter)

describe('POST /api/knesset/transition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns { transitioned: false } when no transition detected', async () => {
    vi.mocked(detectKnessetTransition).mockResolvedValueOnce(false)
    const res = await request(app).post('/api/knesset/transition')
    expect(res.status).toBe(200)
    expect(res.body.transitioned).toBe(false)
    expect(res.body.from).toBe(25)
  })

  it('returns { transitioned: true } when transition detected', async () => {
    vi.mocked(detectKnessetTransition).mockResolvedValueOnce(true)
    vi.mocked(getCurrentKnesset).mockReturnValueOnce(25).mockReturnValueOnce(26)
    const res = await request(app).post('/api/knesset/transition')
    expect(res.status).toBe(200)
    expect(res.body.transitioned).toBe(true)
  })

  it('?force=26 bypasses OData and calls runTransition(26)', async () => {
    const res = await request(app).post('/api/knesset/transition?force=26')
    expect(res.status).toBe(200)
    expect(runTransition).toHaveBeenCalledWith(26)
    expect(detectKnessetTransition).not.toHaveBeenCalled()
  })

  it('returns 400 when ?force is not a valid number', async () => {
    const res = await request(app).post('/api/knesset/transition?force=abc')
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- knesset-route
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/routes/knesset.ts`**

```typescript
import { Router } from 'express'
import { getCurrentKnesset, detectKnessetTransition, runTransition } from '../services/knesset-config'

const router = Router()

router.post('/transition', async (req, res) => {
  const forceParam = req.query.force as string | undefined

  if (forceParam !== undefined) {
    const forceNum = parseInt(forceParam, 10)
    if (isNaN(forceNum) || forceNum < 1) {
      return res.status(400).json({ error: 'force must be a valid Knesset number' })
    }
    const from = getCurrentKnesset()
    await runTransition(forceNum)
    return res.json({ transitioned: true, forced: true, from, to: forceNum })
  }

  const from = getCurrentKnesset()
  try {
    const transitioned = await detectKnessetTransition()
    const to = getCurrentKnesset()
    res.json({ transitioned, from, to })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
```

- [ ] **Step 4: Register in `server/index.ts`**

Add import after existing router imports:
```typescript
import knessetRouter from './routes/knesset'
```

Add route after existing routes:
```typescript
app.use('/api/knesset', knessetRouter)
```

- [ ] **Step 5: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- knesset-route
```

Expected: 4 tests PASS.

- [ ] **Step 6: Run full suite**

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add server/routes/knesset.ts server/index.ts tests/server/knesset-route.test.ts
git commit -m "feat: add POST /api/knesset/transition admin endpoint"
```

---

## Task 4: Startup Detection

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add startup detection to `server/index.ts`**

After the existing `app.listen(...)` block, add a non-blocking startup call:

```typescript
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  startPoller()
  // Non-blocking: detect Knesset transition on startup
  detectKnessetTransition().then((transitioned) => {
    if (transitioned) console.log('Knesset transition detected and applied on startup')
  }).catch((err) => {
    console.error('Knesset transition detection failed on startup:', err)
  })
})
```

Add the import at the top:
```typescript
import { detectKnessetTransition } from './services/knesset-config'
```

- [ ] **Step 2: Run full test suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add server/index.ts
git commit -m "feat: detect Knesset transition on server startup"
```

---

## Task 5: `Mk.inactive` Type, Poller Skip, MkCard Banner

**Files:**
- Modify: `src/types.ts`
- Modify: `server/services/poller.ts`
- Modify: `src/components/parliament/MkCard.tsx`
- Modify: `tests/components/MkCard.test.tsx`

- [ ] **Step 1: Add `inactive` to `Mk` interface in `src/types.ts`**

In the `Mk` interface, add after `lastPolledAt`:
```typescript
inactive?: boolean
```

- [ ] **Step 2: Update poller to skip inactive MKs**

In `server/services/poller.ts`, in `pollMks()`, find the existing guard:
```typescript
const siteId = mk.knesset_site_id ? parseInt(mk.knesset_site_id, 10) : 0
if (!siteId) continue
```

Add `inactive` check before it:
```typescript
if (mk.inactive) continue
const siteId = mk.knesset_site_id ? parseInt(mk.knesset_site_id, 10) : 0
if (!siteId) continue
```

- [ ] **Step 3: Write failing MkCard test for inactive state**

In `tests/components/MkCard.test.tsx`, find the `mkFixture` function and add a test in the existing inactive-related describe block (or at the end of the file):

```typescript
describe('MkCard — inactive MK', () => {
  it('shows inactive banner when mk.inactive is true', () => {
    const inactiveMk = mkFixture({ inactive: true })
    render(<MkCard mk={inactiveMk} />)
    expect(screen.getByText(/לא חבר/i)).toBeInTheDocument()
  })

  it('does not show inactive banner when mk.inactive is false', () => {
    const activeMk = mkFixture({ inactive: false })
    render(<MkCard mk={activeMk} />)
    expect(screen.queryByText(/לא חבר/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run to confirm test failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- MkCard
```

Expected: 2 new tests FAIL (inactive banner not rendered yet).

- [ ] **Step 5: Update `MkCard.tsx` to render inactive banner**

In `src/components/parliament/MkCard.tsx`, inside the `MkCard` component function, find the return statement. After the MK header block (photo + name + party) and before the `votingSummary` section, add:

```typescript
{mk.inactive && (
  <div className="mb-3 rounded-md bg-slate-100 px-3 py-2">
    <p className="text-right text-xs font-medium text-slate-500">
      לא חבר/ת כנסת פעיל/ה
    </p>
  </div>
)}
```

Also add `opacity-60` to the left-border strip when inactive. Find:
```typescript
<div className="w-1 shrink-0 bg-purple-500" />
```
Replace with:
```typescript
<div className={`w-1 shrink-0 bg-purple-500 ${mk.inactive ? 'opacity-60' : ''}`} />
```

- [ ] **Step 6: Run MkCard tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- MkCard
```

Expected: all MkCard tests PASS including 2 new inactive tests.

- [ ] **Step 7: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/types.ts server/services/poller.ts src/components/parliament/MkCard.tsx tests/components/MkCard.test.tsx
git commit -m "feat: Mk.inactive type, poller skip, MkCard grey banner for inactive MKs"
```

---

## Task 6: Final Verification + Merge

- [ ] **Step 1: Run full test suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Verify the config is in the right state**

```bash
cat /home/aavitan/claude-projects/liberal-page/src/data/knesset-config.json
```

Expected:
```json
{ "currentKnesset": 25, "detectedAt": "2022-11-01T00:00:00.000Z" }
```

- [ ] **Step 3: Smoke test the admin endpoint**

Start the server (`npm run dev:server`) then in a separate terminal:

```bash
curl -X POST http://localhost:3001/api/knesset/transition
# Expected: { "transitioned": false, "from": 25, "to": 25 }

curl -X POST "http://localhost:3001/api/knesset/transition?force=26"
# Expected: { "transitioned": true, "forced": true, "from": 25, "to": 26 }
# Then restore:
curl -X POST "http://localhost:3001/api/knesset/transition?force=25"
```

- [ ] **Step 4: Push to origin**

```bash
cd /home/aavitan/claude-projects/liberal-page && git push origin master
```
