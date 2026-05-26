# Knesset Bills Overview (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Hebrew-gated "Knesset Bills Overview" section with three tabs — Recent (newest-introduced bills), Trending (manually curated), and Policy-aligned (keyword-filtered) — each row expandable inline for details.

**Architecture:** New backend routes under `/api/bills/*` query the Knesset OData API live (with a short in-memory TTL cache), resolve numeric `StatusID` to Hebrew labels via a cached `KNS_Status` lookup, and return a flat `KnessetBillOverviewItem`. A new `useBillsOverview` hook fetches all three tabs with independent per-tab loading/error/retry. A `KnessetBillsOverview` section renders tabs + expandable rows, mounted after `ParliamentStrip` and gated to `i18n.language === 'he'`.

**Tech Stack:** Express 5 + `tsx` (backend), React 18 + Vite + Tailwind (frontend), Vitest + supertest + @testing-library/react (tests), Knesset OData API (`KNS_Bill`, `KNS_Status`).

**Scope note:** This is **Phase 1**. Recent ranks by `BillID desc` (newest-introduced). Phase 2 (separate spec) re-ranks Recent by genuine legislative-event recency behind the `recentRanking: "progress"` flag, and may add the `amendments`/`sponsorship` trending algorithms. Committee-name resolution is deferred to Phase 2 (the `committee` field exists but is empty in v1).

---

## File Structure

**Create:**
- `src/data/feature-flags.json` — runtime feature flags (`trendingAlgorithm`, `recentRanking`, `policyFilterEnabled`)
- `src/data/trending-bills.json` — manually curated trending bills
- `server/services/bill-status-map.ts` — fetch + cache `KNS_Status` (TypeID 2), expose `getBillStatusMap()`
- `server/services/knesset-bills.ts` — OData query helpers + overview-item mapping + TTL cache + keyword list + flag reader
- `src/hooks/useBillsOverview.ts` — three-tab fetch hook
- `src/components/sections/KnessetBillsOverview.tsx` — section owning tab state
- `src/components/parliament/BillsTabs.tsx` — tab bar
- `src/components/parliament/BillsList.tsx` — list + loading/error/retry
- `src/components/parliament/BillOverviewRow.tsx` — expandable row
- Tests: `tests/server/bill-status-map.test.ts`, `tests/server/bills-overview-route.test.ts`, `tests/unit/useBillsOverview.test.ts`, `tests/components/BillOverviewRow.test.tsx`, `tests/components/KnessetBillsOverview.test.tsx`

**Modify:**
- `src/types.ts` — add `KnessetBillOverviewItem`, `TrendingBillEntry`, `BillsFeatureFlags`
- `server/routes/bills.ts` — add `GET /recent`, `GET /trending`, `GET /policy-aligned`
- `src/lib/api-client.ts` — add `api.bills.recent/trending/policyAligned`
- `src/App.tsx` — mount `<KnessetBillsOverview />` after `ParliamentStrip`

---

## Task 1: Types and data/config files

**Files:**
- Modify: `src/types.ts`
- Create: `src/data/feature-flags.json`
- Create: `src/data/trending-bills.json`

- [ ] **Step 1: Add types to `src/types.ts`** (append at end of file)

```ts
export interface KnessetBillOverviewItem {
  billId: number
  title: string
  statusId: number
  status: string        // Hebrew label mapped from statusId; '' if unknown
  committee: string      // reserved; '' in Phase 1 (committee-name resolution is Phase 2)
  lastUpdatedDate: string
  summary: string        // SummaryLaw; may be ''
  knessetUrl: string
  reason?: string        // present only for curated trending items
}

export interface TrendingBillEntry {
  billId: number
  title: string
  reason: string
}

export interface BillsFeatureFlags {
  trendingAlgorithm: 'manual' | 'amendments' | 'sponsorship'
  recentRanking: 'newest' | 'progress'
  policyFilterEnabled: boolean
}
```

- [ ] **Step 2: Create `src/data/feature-flags.json`**

```json
{
  "bills": {
    "trendingAlgorithm": "manual",
    "recentRanking": "newest",
    "policyFilterEnabled": true
  }
}
```

- [ ] **Step 3: Create `src/data/trending-bills.json`** (seed with one real tracked bill)

```json
{
  "bills": [
    {
      "billId": 1044632,
      "title": "הצעת חוק לתיקון פקודת מס הכנסה (מס' 285) (נכס דיגיטלי), התשפ\"ו-2026",
      "reason": "סוגייה ליברלית חשובה — מס על נכסים דיגיטליים"
    }
  ]
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/data/feature-flags.json src/data/trending-bills.json
git commit -m "feat(bills-overview): add types, feature flags, and trending seed data"
```

---

## Task 2: Bill status map service

Fetches `KNS_Status` (bill statuses, `TypeID eq 2`) once and caches the `StatusID → Hebrew` map in memory.

**Files:**
- Create: `server/services/bill-status-map.ts`
- Test: `tests/server/bill-status-map.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { getBillStatusMap, _resetStatusMapCache } from '../../server/services/bill-status-map'

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

describe('getBillStatusMap', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    _resetStatusMapCache()
  })

  it('maps StatusID to Hebrew Desc', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([
      { StatusID: 101, Desc: 'הכנה לקריאה ראשונה' },
      { StatusID: 108, Desc: 'הכנה לקריאה ראשונה' },
    ]))
    const map = await getBillStatusMap()
    expect(map.get(101)).toBe('הכנה לקריאה ראשונה')
  })

  it('caches the result (fetch called once across two calls)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([{ StatusID: 101, Desc: 'הכנה לקריאה ראשונה' }]))
    await getBillStatusMap()
    await getBillStatusMap()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('returns an empty map when OData fails (does not throw)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    const map = await getBillStatusMap()
    expect(map.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/bill-status-map.test.ts`
Expected: FAIL — cannot find module `bill-status-map`

- [ ] **Step 3: Write the implementation**

Create `server/services/bill-status-map.ts`:

```ts
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const TTL_MS = 24 * 60 * 60 * 1000 // statuses are near-static; refresh daily

let cache: { map: Map<number, string>; at: number } | null = null

export function _resetStatusMapCache() {
  cache = null
}

export async function getBillStatusMap(): Promise<Map<number, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map

  const url = `${ODATA_BASE}/KNS_Status?$filter=TypeID%20eq%202&$select=StatusID,Desc&$format=json`
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`OData error ${res.status}`)
    const data = (await res.json()) as { value: Array<{ StatusID: number; Desc: string }> }
    const map = new Map<number, string>()
    for (const row of data.value ?? []) map.set(row.StatusID, row.Desc)
    cache = { map, at: Date.now() }
    return map
  } catch {
    // Don't poison the cache on failure; return empty so callers fall back to ''
    return new Map()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/bill-status-map.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/bill-status-map.ts tests/server/bill-status-map.test.ts
git commit -m "feat(bills-overview): add KNS_Status-backed bill status label map"
```

---

## Task 3: Knesset bills service — recent + mapping + TTL cache

**Files:**
- Create: `server/services/knesset-bills.ts`
- Test: `tests/server/knesset-bills.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())
vi.mock('../../server/services/bill-status-map', () => ({
  getBillStatusMap: vi.fn(async () => new Map([[101, 'הכנה לקריאה ראשונה']])),
}))
vi.mock('../../server/services/knesset-config', () => ({ getCurrentKnesset: () => 25 }))

import { fetchRecentBills, _resetBillsCache } from '../../server/services/knesset-bills'

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

const RAW = [
  { BillID: 1044632, Name: 'הצעת חוק א', StatusID: 101, CommitteeID: 5, LastUpdatedDate: '2026-05-01', SummaryLaw: 'תקציר' },
  { BillID: 1044000, Name: 'הצעת חוק ב', StatusID: 999, CommitteeID: null, LastUpdatedDate: '2026-04-01', SummaryLaw: '' },
]

describe('fetchRecentBills', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    _resetBillsCache()
  })

  it('maps OData rows to overview items with resolved status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(RAW))
    const items = await fetchRecentBills(10)
    expect(items).toHaveLength(2)
    expect(items[0].billId).toBe(1044632)
    expect(items[0].status).toBe('הכנה לקריאה ראשונה')
    expect(items[0].summary).toBe('תקציר')
    expect(items[0].knessetUrl).toContain('lawitemid=1044632')
    expect(items[0].committee).toBe('') // Phase 1: committee name not resolved
  })

  it('falls back to empty status string for unknown StatusID', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(RAW))
    const items = await fetchRecentBills(10)
    expect(items[1].status).toBe('')
  })

  it('orders by BillID desc via the OData query (not LastUpdatedDate)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(RAW))
    await fetchRecentBills(10)
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
    expect(calledUrl).toContain('$orderby=BillID%20desc')
    expect(calledUrl).not.toContain('LastUpdatedDate')
  })

  it('caches results within TTL (one fetch for two calls)', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOdata(RAW))
    await fetchRecentBills(10)
    await fetchRecentBills(10)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/knesset-bills.test.ts`
Expected: FAIL — cannot find module `knesset-bills`

- [ ] **Step 3: Write the implementation**

Create `server/services/knesset-bills.ts`:

```ts
import type { KnessetBillOverviewItem } from '../../src/types'
import { getBillStatusMap } from './bill-status-map'
import { getCurrentKnesset } from './knesset-config'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const TTL_MS = 5 * 60 * 1000

function knessetUrl(billId: number): string {
  return `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=${billId}`
}

interface RawBill {
  BillID: number
  Name: string
  StatusID: number
  CommitteeID: number | null
  LastUpdatedDate: string
  SummaryLaw: string | null
}

async function mapRows(rows: RawBill[]): Promise<KnessetBillOverviewItem[]> {
  const statusMap = await getBillStatusMap()
  return rows.map((r) => ({
    billId: r.BillID,
    title: r.Name.trim(),
    statusId: r.StatusID,
    status: statusMap.get(r.StatusID) ?? '',
    committee: '', // Phase 1: committee name not resolved
    lastUpdatedDate: r.LastUpdatedDate ?? '',
    summary: (r.SummaryLaw ?? '').trim(),
    knessetUrl: knessetUrl(r.BillID),
  }))
}

const cache = new Map<string, { items: KnessetBillOverviewItem[]; at: number }>()

export function _resetBillsCache() {
  cache.clear()
}

async function cachedQuery(key: string, odataPath: string): Promise<KnessetBillOverviewItem[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items

  const res = await fetch(`${ODATA_BASE}/${odataPath}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OData error ${res.status}`)
  const data = (await res.json()) as { value: RawBill[] }
  const items = await mapRows(data.value ?? [])
  cache.set(key, { items, at: Date.now() })
  return items
}

const SELECT = 'BillID,Name,StatusID,CommitteeID,LastUpdatedDate,SummaryLaw'

export async function fetchRecentBills(limit: number): Promise<KnessetBillOverviewItem[]> {
  const k = getCurrentKnesset()
  const path = `KNS_Bill?$filter=KnessetNum%20eq%20${k}&$orderby=BillID%20desc&$top=${limit}&$select=${SELECT}&$format=json`
  return cachedQuery(`recent:${k}:${limit}`, path)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/knesset-bills.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/knesset-bills.ts tests/server/knesset-bills.test.ts
git commit -m "feat(bills-overview): add knesset-bills service with recent query + TTL cache"
```

---

## Task 4: Knesset bills service — policy-aligned query

**Files:**
- Modify: `server/services/knesset-bills.ts`
- Test: `tests/server/knesset-bills.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test** (append to `tests/server/knesset-bills.test.ts`)

```ts
import { fetchPolicyAlignedBills, LIBERAL_KEYWORDS } from '../../server/services/knesset-bills'

describe('fetchPolicyAlignedBills', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    _resetBillsCache()
  })

  it('builds an OData filter OR-ing the liberal keywords with substringof', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(RAW))
    await fetchPolicyAlignedBills(10)
    const calledUrl = decodeURIComponent(vi.mocked(fetch).mock.calls[0][0] as string)
    expect(LIBERAL_KEYWORDS.length).toBeGreaterThan(0)
    expect(calledUrl).toContain(`substringof('${LIBERAL_KEYWORDS[0]}',Name)`)
    expect(calledUrl).toContain(' or ')
    expect(calledUrl).toContain('$orderby=BillID desc')
  })

  it('returns mapped overview items', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(RAW))
    const items = await fetchPolicyAlignedBills(10)
    expect(items[0].billId).toBe(1044632)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/knesset-bills.test.ts`
Expected: FAIL — `fetchPolicyAlignedBills`/`LIBERAL_KEYWORDS` not exported

- [ ] **Step 3: Add the implementation** (append to `server/services/knesset-bills.ts`)

```ts
export const LIBERAL_KEYWORDS = ['חירות', 'שוק חופשי', 'זכויות', 'תחרות', 'רגולציה', 'קניין']

export async function fetchPolicyAlignedBills(limit: number): Promise<KnessetBillOverviewItem[]> {
  const k = getCurrentKnesset()
  const ors = LIBERAL_KEYWORDS.map((kw) => `substringof('${kw}',Name)`).join(' or ')
  const filter = `KnessetNum eq ${k} and (${ors})`
  const path =
    `KNS_Bill?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=${encodeURIComponent('BillID desc')}&$top=${limit}` +
    `&$select=${SELECT}&$format=json`
  return cachedQuery(`policy:${k}:${limit}`, path)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/knesset-bills.test.ts`
Expected: PASS (6 tests total in file)

- [ ] **Step 5: Commit**

```bash
git add server/services/knesset-bills.ts tests/server/knesset-bills.test.ts
git commit -m "feat(bills-overview): add policy-aligned keyword query"
```

---

## Task 5: Knesset bills service — trending (manual) + flag reader

**Files:**
- Modify: `server/services/knesset-bills.ts`
- Test: `tests/server/knesset-bills.test.ts` (add describe block)

- [ ] **Step 1: Write the failing test** (append)

```ts
import { readFile } from 'fs/promises'
import { getTrendingBills, getBillsFlags } from '../../server/services/knesset-bills'
vi.mock('fs/promises')

describe('getTrendingBills (manual)', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    _resetBillsCache()
  })

  it('returns curated entries hydrated with reason, status resolved live', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({
      bills: [{ billId: 1044632, title: 'הצעת חוק א', reason: 'סיבה' }],
    }) as never)
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([
      { BillID: 1044632, Name: 'הצעת חוק א', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: 'תקציר' },
    ]))
    const items = await getTrendingBills()
    expect(items[0].billId).toBe(1044632)
    expect(items[0].reason).toBe('סיבה')
    expect(items[0].status).toBe('הכנה לקריאה ראשונה')
  })
})

describe('getBillsFlags', () => {
  it('reads flags from feature-flags.json', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({
      bills: { trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: false },
    }) as never)
    const flags = await getBillsFlags()
    expect(flags.policyFilterEnabled).toBe(false)
    expect(flags.trendingAlgorithm).toBe('manual')
  })
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/knesset-bills.test.ts`
Expected: FAIL — `getTrendingBills`/`getBillsFlags` not exported

- [ ] **Step 3: Add the implementation** (append to `server/services/knesset-bills.ts`)

```ts
import { readFile } from 'fs/promises'
import path from 'path'
import type { BillsFeatureFlags, TrendingBillEntry } from '../../src/types'

const DATA_DIR = path.join(process.cwd(), 'src/data')

export async function getBillsFlags(): Promise<BillsFeatureFlags> {
  const raw = await readFile(path.join(DATA_DIR, 'feature-flags.json'), 'utf-8')
  return (JSON.parse(raw) as { bills: BillsFeatureFlags }).bills
}

async function fetchBillsByIds(ids: number[]): Promise<Map<number, KnessetBillOverviewItem>> {
  if (ids.length === 0) return new Map()
  const ors = ids.map((id) => `BillID eq ${id}`).join(' or ')
  const path = `KNS_Bill?$filter=${encodeURIComponent(ors)}&$top=${ids.length}&$select=${SELECT}&$format=json`
  const res = await fetch(`${ODATA_BASE}/${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OData error ${res.status}`)
  const data = (await res.json()) as { value: RawBill[] }
  const mapped = await mapRows(data.value ?? [])
  return new Map(mapped.map((b) => [b.billId, b]))
}

export async function getTrendingBills(): Promise<KnessetBillOverviewItem[]> {
  const flags = await getBillsFlags()
  // Only 'manual' is implemented; others fall back to manual.
  void flags.trendingAlgorithm
  const raw = await readFile(path.join(DATA_DIR, 'trending-bills.json'), 'utf-8')
  const entries = (JSON.parse(raw) as { bills: TrendingBillEntry[] }).bills
  const live = await fetchBillsByIds(entries.map((e) => e.billId))
  return entries.map((e) => {
    const hydrated = live.get(e.billId)
    return hydrated
      ? { ...hydrated, reason: e.reason }
      : {
          billId: e.billId,
          title: e.title,
          statusId: 0,
          status: '',
          committee: '',
          lastUpdatedDate: '',
          summary: '',
          knessetUrl: knessetUrl(e.billId),
          reason: e.reason,
        }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/knesset-bills.test.ts`
Expected: PASS (8 tests total)

- [ ] **Step 5: Commit**

```bash
git add server/services/knesset-bills.ts tests/server/knesset-bills.test.ts
git commit -m "feat(bills-overview): add manual trending hydration and flag reader"
```

---

## Task 6: Routes — GET /recent, /trending, /policy-aligned

**Files:**
- Modify: `server/routes/bills.ts`
- Test: `tests/server/bills-overview-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../../server/services/knesset-bills', () => ({
  fetchRecentBills: vi.fn(),
  fetchPolicyAlignedBills: vi.fn(),
  getTrendingBills: vi.fn(),
  getBillsFlags: vi.fn(),
}))

import billsRouter from '../../server/routes/bills'
import {
  fetchRecentBills, fetchPolicyAlignedBills, getTrendingBills, getBillsFlags,
} from '../../server/services/knesset-bills'

const app = express()
app.use(express.json())
app.use('/api/bills', billsRouter)

const ITEM = {
  billId: 1, title: 'x', statusId: 101, status: 'הכנה', committee: '',
  lastUpdatedDate: '2026-05-01', summary: '', knessetUrl: 'http://k/1',
}

describe('GET /api/bills/recent', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns mapped recent bills', async () => {
    vi.mocked(fetchRecentBills).mockResolvedValue([ITEM])
    const res = await request(app).get('/api/bills/recent')
    expect(res.status).toBe(200)
    expect(res.body[0].billId).toBe(1)
    expect(vi.mocked(fetchRecentBills).mock.calls[0][0]).toBe(10) // default limit
  })
  it('returns 500 with error message on failure', async () => {
    vi.mocked(fetchRecentBills).mockRejectedValue(new Error('boom'))
    const res = await request(app).get('/api/bills/recent')
    expect(res.status).toBe(500)
    expect(res.body.error).toBeDefined()
  })
})

describe('GET /api/bills/trending', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns trending bills', async () => {
    vi.mocked(getTrendingBills).mockResolvedValue([{ ...ITEM, reason: 'r' }])
    const res = await request(app).get('/api/bills/trending')
    expect(res.status).toBe(200)
    expect(res.body[0].reason).toBe('r')
  })
})

describe('GET /api/bills/policy-aligned', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns policy-aligned bills when enabled', async () => {
    vi.mocked(getBillsFlags).mockResolvedValue({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true })
    vi.mocked(fetchPolicyAlignedBills).mockResolvedValue([ITEM])
    const res = await request(app).get('/api/bills/policy-aligned')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
  it('returns 404 when policyFilterEnabled is false', async () => {
    vi.mocked(getBillsFlags).mockResolvedValue({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: false })
    const res = await request(app).get('/api/bills/policy-aligned')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/bills-overview-route.test.ts`
Expected: FAIL — routes return 404 (not yet defined)

- [ ] **Step 3: Add routes to `server/routes/bills.ts`**

Add these imports at the top (after the existing imports):

```ts
import { fetchRecentBills, fetchPolicyAlignedBills, getTrendingBills, getBillsFlags } from '../services/knesset-bills'
```

Add these routes BEFORE `export default router` (the static `/search` and `/track` are unaffected; these new paths don't collide):

```ts
function parseLimit(q: unknown): number {
  const n = Number(q)
  return Number.isFinite(n) && n > 0 && n <= 50 ? Math.floor(n) : 10
}

router.get('/recent', async (req, res) => {
  try {
    res.json(await fetchRecentBills(parseLimit(req.query.limit)))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.get('/trending', async (_req, res) => {
  try {
    res.json(await getTrendingBills())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.get('/policy-aligned', async (req, res) => {
  try {
    const flags = await getBillsFlags()
    if (!flags.policyFilterEnabled) return res.status(404).json({ error: 'Policy filter disabled' })
    res.json(await fetchPolicyAlignedBills(parseLimit(req.query.limit)))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/bills-overview-route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full server test suite to confirm no regressions**

Run: `npx vitest run tests/server/`
Expected: PASS (existing bills-route tests still green — `/search` and `/track` unchanged)

- [ ] **Step 6: Commit**

```bash
git add server/routes/bills.ts tests/server/bills-overview-route.test.ts
git commit -m "feat(bills-overview): add /recent, /trending, /policy-aligned routes"
```

---

## Task 7: API client methods

**Files:**
- Modify: `src/lib/api-client.ts`

- [ ] **Step 1: Extend the `bills` namespace in `src/lib/api-client.ts`**

Add the import to the existing type import line:

```ts
import type { Bill, Committee, Mk, TrackingType, KnessetMember, MkActivity, BillSearchResult, CommitteeListItem, KnessetBillOverviewItem } from '@/types'
```

Replace the `bills:` block with:

```ts
  bills: {
    search: (q: string) => apiFetch<BillSearchResult[]>(`/bills/search?q=${encodeURIComponent(q)}`),
    track: (billId: number, name: string, knessetUrl: string) =>
      apiFetch<{ ok: boolean; duplicate?: boolean; item?: Bill }>('/bills/track', {
        method: 'POST',
        body: JSON.stringify({ billId, name, knessetUrl }),
      }),
    recent: (limit = 10) => apiFetch<KnessetBillOverviewItem[]>(`/bills/recent?limit=${limit}`),
    trending: () => apiFetch<KnessetBillOverviewItem[]>('/bills/trending'),
    policyAligned: (limit = 10) => apiFetch<KnessetBillOverviewItem[]>(`/bills/policy-aligned?limit=${limit}`),
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-client.ts
git commit -m "feat(bills-overview): add api client methods for overview tabs"
```

---

## Task 8: `useBillsOverview` hook

Fetches all three tabs on mount with independent per-tab state and retry. Reads `policyFilterEnabled` from the imported flags to skip the policy fetch when disabled.

**Files:**
- Create: `src/hooks/useBillsOverview.ts`
- Test: `tests/unit/useBillsOverview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: { bills: { recent: vi.fn(), trending: vi.fn(), policyAligned: vi.fn() } },
}))
vi.mock('@/data/feature-flags.json', () => ({
  default: { bills: { trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true } },
}))

import { useBillsOverview } from '@/hooks/useBillsOverview'
import { api } from '@/lib/api-client'

const ITEM = { billId: 1, title: 'x', statusId: 101, status: 'הכנה', committee: '', lastUpdatedDate: '', summary: '', knessetUrl: 'http://k/1' }

describe('useBillsOverview', () => {
  beforeEach(() => {
    vi.mocked(api.bills.recent).mockResolvedValue([ITEM])
    vi.mocked(api.bills.trending).mockResolvedValue([{ ...ITEM, reason: 'r' }])
    vi.mocked(api.bills.policyAligned).mockResolvedValue([ITEM])
  })

  it('loads all three tabs', async () => {
    const { result } = renderHook(() => useBillsOverview())
    await waitFor(() => expect(result.current.recent.loading).toBe(false))
    expect(result.current.recent.items).toHaveLength(1)
    expect(result.current.trending.items[0].reason).toBe('r')
    expect(result.current.policyAligned.items).toHaveLength(1)
  })

  it('captures a per-tab error without affecting others', async () => {
    vi.mocked(api.bills.recent).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useBillsOverview())
    await waitFor(() => expect(result.current.recent.loading).toBe(false))
    expect(result.current.recent.error).toBe('boom')
    expect(result.current.trending.items).toHaveLength(1)
  })

  it('retry re-fetches a failed tab', async () => {
    vi.mocked(api.bills.recent).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useBillsOverview())
    await waitFor(() => expect(result.current.recent.error).toBe('boom'))
    vi.mocked(api.bills.recent).mockResolvedValue([ITEM])
    await act(async () => { await result.current.recent.retry() })
    await waitFor(() => expect(result.current.recent.items).toHaveLength(1))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/useBillsOverview.test.ts`
Expected: FAIL — cannot find module `useBillsOverview`

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useBillsOverview.ts`:

```ts
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api-client'
import type { KnessetBillOverviewItem } from '@/types'
import flagsConfig from '@/data/feature-flags.json'

export interface TabState {
  items: KnessetBillOverviewItem[]
  loading: boolean
  error: string | null
  retry: () => Promise<void>
}

const policyEnabled = flagsConfig.bills.policyFilterEnabled

function useTab(fetcher: () => Promise<KnessetBillOverviewItem[]>, enabled = true): TabState {
  const [items, setItems] = useState<KnessetBillOverviewItem[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setItems(await fetcher())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
    // fetcher is a stable api method reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => { void load() }, [load])

  return { items, loading, error, retry: load }
}

export function useBillsOverview() {
  const recent = useTab(() => api.bills.recent(10))
  const trending = useTab(() => api.bills.trending())
  const policyAligned = useTab(() => api.bills.policyAligned(10), policyEnabled)
  return { recent, trending, policyAligned, policyEnabled }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/useBillsOverview.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBillsOverview.ts tests/unit/useBillsOverview.test.ts
git commit -m "feat(bills-overview): add useBillsOverview hook with per-tab retry"
```

---

## Task 9: `BillOverviewRow` component (expandable)

**Files:**
- Create: `src/components/parliament/BillOverviewRow.tsx`
- Test: `tests/components/BillOverviewRow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import BillOverviewRow from '@/components/parliament/BillOverviewRow'

const BILL = {
  billId: 1, title: 'הצעת חוק חופש העיסוק', statusId: 101, status: 'הכנה לקריאה ראשונה',
  committee: '', lastUpdatedDate: '2026-05-01', summary: 'תקציר החוק', knessetUrl: 'https://k/1',
}

describe('BillOverviewRow', () => {
  it('shows title and status in compact view, hides summary until expanded', () => {
    render(<BillOverviewRow bill={BILL} />)
    expect(screen.getByText('הצעת חוק חופש העיסוק')).toBeInTheDocument()
    expect(screen.getByText('הכנה לקריאה ראשונה')).toBeInTheDocument()
    expect(screen.queryByText('תקציר החוק')).not.toBeInTheDocument()
  })

  it('expands to show summary and Knesset link on click', async () => {
    render(<BillOverviewRow bill={BILL} />)
    await userEvent.click(screen.getByRole('button', { name: /הצעת חוק חופש העיסוק/ }))
    expect(screen.getByText('תקציר החוק')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /קישור לכנסת/ })
    expect(link).toHaveAttribute('href', 'https://k/1')
  })

  it('renders the curated reason when present', async () => {
    render(<BillOverviewRow bill={{ ...BILL, reason: 'סיבה ליברלית' }} />)
    await userEvent.click(screen.getByRole('button', { name: /הצעת חוק חופש העיסוק/ }))
    expect(screen.getByText('סיבה ליברלית')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/BillOverviewRow.test.tsx`
Expected: FAIL — cannot find module `BillOverviewRow`

- [ ] **Step 3: Write the implementation**

Create `src/components/parliament/BillOverviewRow.tsx`:

```tsx
import { useState } from 'react'
import type { KnessetBillOverviewItem } from '@/types'

export default function BillOverviewRow({ bill }: { bill: KnessetBillOverviewItem }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <li className="border-b border-border py-3" dir="rtl">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 text-right"
      >
        <span className="flex-1 truncate font-medium">{bill.title}</span>
        {bill.status && (
          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">{bill.status}</span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          {bill.committee && <p>{bill.committee}</p>}
          {bill.summary && <p>{bill.summary}</p>}
          {bill.reason && <p className="font-medium text-foreground">{bill.reason}</p>}
          {bill.lastUpdatedDate && <p className="text-xs">עודכן: {bill.lastUpdatedDate}</p>}
          <a
            href={bill.knessetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-primary underline"
          >
            קישור לכנסת ↗
          </a>
        </div>
      )}
    </li>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/BillOverviewRow.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/parliament/BillOverviewRow.tsx tests/components/BillOverviewRow.test.tsx
git commit -m "feat(bills-overview): add expandable BillOverviewRow"
```

---

## Task 10: `BillsList` component (loading / error / retry / list)

**Files:**
- Create: `src/components/parliament/BillsList.tsx`

- [ ] **Step 1: Write the implementation** (presentational; covered by the section test in Task 12)

Create `src/components/parliament/BillsList.tsx`:

```tsx
import type { TabState } from '@/hooks/useBillsOverview'
import BillOverviewRow from './BillOverviewRow'

export default function BillsList({ tab }: { tab: TabState }) {
  if (tab.loading) return <p className="py-4 text-center text-muted-foreground">טוען…</p>
  if (tab.error) {
    return (
      <div className="py-4 text-center">
        <p className="text-destructive">שגיאה בטעינת הצעות החוק</p>
        <button type="button" onClick={() => void tab.retry()} className="mt-2 text-primary underline">
          נסה שוב
        </button>
      </div>
    )
  }
  if (tab.items.length === 0) return <p className="py-4 text-center text-muted-foreground">אין הצעות חוק להצגה</p>

  return (
    <ul className="max-h-[28rem] overflow-y-auto" dir="rtl">
      {tab.items.map((bill) => (
        <BillOverviewRow key={bill.billId} bill={bill} />
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/parliament/BillsList.tsx
git commit -m "feat(bills-overview): add BillsList with loading/error/retry states"
```

---

## Task 11: `BillsTabs` component

**Files:**
- Create: `src/components/parliament/BillsTabs.tsx`

- [ ] **Step 1: Write the implementation**

Create `src/components/parliament/BillsTabs.tsx`:

```tsx
export type BillsTabId = 'recent' | 'trending' | 'policy'

const LABELS: Record<BillsTabId, string> = {
  recent: 'חדשות',
  trending: 'בולטות',
  policy: 'ליברליות',
}

export default function BillsTabs({
  active,
  tabs,
  onChange,
}: {
  active: BillsTabId
  tabs: BillsTabId[]
  onChange: (id: BillsTabId) => void
}) {
  return (
    <div className="flex gap-2 border-b border-border" role="tablist" dir="rtl">
      {tabs.map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={active === id}
          onClick={() => onChange(id)}
          className={`px-4 py-2 text-sm font-medium ${
            active === id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
          }`}
        >
          {LABELS[id]}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/parliament/BillsTabs.tsx
git commit -m "feat(bills-overview): add BillsTabs tab bar"
```

---

## Task 12: `KnessetBillsOverview` section

**Files:**
- Create: `src/components/sections/KnessetBillsOverview.tsx`
- Test: `tests/components/KnessetBillsOverview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const ITEM = { billId: 1, title: 'הצעת חוק א', statusId: 101, status: 'הכנה', committee: '', lastUpdatedDate: '', summary: '', knessetUrl: 'http://k/1' }
const POLICY = { ...ITEM, billId: 2, title: 'הצעת חוק ליברלית' }

vi.mock('@/lib/api-client', () => ({
  api: {
    bills: {
      recent: vi.fn().mockResolvedValue([ITEM]),
      trending: vi.fn().mockResolvedValue([{ ...ITEM, billId: 3, title: 'בולטת', reason: 'r' }]),
      policyAligned: vi.fn().mockResolvedValue([POLICY]),
    },
  },
}))
vi.mock('@/data/feature-flags.json', () => ({
  default: { bills: { trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true } },
}))

import KnessetBillsOverview from '@/components/sections/KnessetBillsOverview'

describe('KnessetBillsOverview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the recent tab by default', async () => {
    render(<KnessetBillsOverview />)
    await waitFor(() => expect(screen.getByText('הצעת חוק א')).toBeInTheDocument())
  })

  it('switches to the policy tab on click', async () => {
    render(<KnessetBillsOverview />)
    await userEvent.click(screen.getByRole('tab', { name: 'ליברליות' }))
    await waitFor(() => expect(screen.getByText('הצעת חוק ליברלית')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/KnessetBillsOverview.test.tsx`
Expected: FAIL — cannot find module `KnessetBillsOverview`

- [ ] **Step 3: Write the implementation**

Create `src/components/sections/KnessetBillsOverview.tsx`:

```tsx
import { useState } from 'react'
import { useBillsOverview } from '@/hooks/useBillsOverview'
import BillsTabs, { type BillsTabId } from '@/components/parliament/BillsTabs'
import BillsList from '@/components/parliament/BillsList'

export default function KnessetBillsOverview() {
  const { recent, trending, policyAligned, policyEnabled } = useBillsOverview()
  const [active, setActive] = useState<BillsTabId>('recent')

  const tabs: BillsTabId[] = policyEnabled ? ['recent', 'trending', 'policy'] : ['recent', 'trending']
  const tabState = active === 'recent' ? recent : active === 'trending' ? trending : policyAligned

  return (
    <section className="mx-auto max-w-3xl px-4 py-8" dir="rtl">
      <h2 className="mb-1 text-xl font-bold">מה קורה בכנסת</h2>
      <p className="mb-4 text-sm text-muted-foreground">הצעות חוק מרחבי הכנסת</p>
      <BillsTabs active={active} tabs={tabs} onChange={setActive} />
      <div className="mt-2">
        <BillsList tab={tabState} />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/KnessetBillsOverview.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/KnessetBillsOverview.tsx tests/components/KnessetBillsOverview.test.tsx
git commit -m "feat(bills-overview): add KnessetBillsOverview section with tabs"
```

---

## Task 13: Wire into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import** (after the `ParliamentStrip` import, line ~9)

```tsx
import KnessetBillsOverview from '@/components/sections/KnessetBillsOverview'
```

- [ ] **Step 2: Mount it after `ParliamentStrip`** (inside the existing `{isHebrew && (...)}` region)

Replace:

```tsx
        {isHebrew && (
          <ParliamentStrip bills={bills} committees={committees} onOpenDrawer={handleOpenDrawer} />
        )}
```

with:

```tsx
        {isHebrew && (
          <>
            <ParliamentStrip bills={bills} committees={committees} onOpenDrawer={handleOpenDrawer} />
            <KnessetBillsOverview />
          </>
        )}
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (all tests, no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(bills-overview): mount section in Hebrew parliament area"
```

---

## Task 14: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start both servers**

Run: `pkill -f "vite|tsx server"; npm run dev`
Wait for both: Vite on :5173, Express on :3001.

- [ ] **Step 2: Verify each route returns live data**

```bash
curl -s "http://localhost:3001/api/bills/recent?limit=5" | python3 -m json.tool | head -30
curl -s "http://localhost:3001/api/bills/trending" | python3 -m json.tool | head -30
curl -s "http://localhost:3001/api/bills/policy-aligned?limit=5" | python3 -m json.tool | head -30
```
Expected: each returns a JSON array of overview items; `recent` is ordered by descending `billId`; `status` fields are Hebrew labels (not numbers); `trending` items include `reason`.

- [ ] **Step 3: Verify in the browser**

Open `http://localhost:5173` (Hebrew view). Below the parliament strip, confirm:
- "מה קורה בכנסת" section with three tabs (חדשות / בולטות / ליברליות)
- Clicking a row expands it (summary, date, "קישור לכנסת ↗" opens the Knesset page)
- Switching tabs swaps the list
- Switch the site to English → the section disappears (Hebrew-gated)

- [ ] **Step 4: Verify the policy flag**

Edit `src/data/feature-flags.json`, set `policyFilterEnabled` to `false`, restart the server. Confirm the "ליברליות" tab is gone and `/api/bills/policy-aligned` returns 404. Revert to `true`.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "fix(bills-overview): address manual verification findings"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Recent (Task 3/6), Trending manual (Task 5/6), Policy-aligned (Task 4/6), expandable rows (Task 9), tabs + same-window layout (Tasks 11–12), feature flags (Tasks 1,5,6,8,12), status map from KNS_Status (Task 2), Hebrew gating + placement (Task 13). All covered.
- **Type consistency:** `KnessetBillOverviewItem` is defined once (Task 1) and used unchanged in the service, routes, api-client, hook, and components. `TabState` defined in the hook (Task 8) and consumed by `BillsList` (Task 10). `BillsTabId` defined in `BillsTabs` (Task 11) and imported by the section (Task 12).
- **Deferred (documented, not placeholders):** committee-name resolution (field present, empty in v1 — `knesset-committees-cache.json` is runtime-generated and not guaranteed present); Recent v2 progress-ranking and amendments/sponsorship algorithms (Phase 2, flag-gated and falling back).
