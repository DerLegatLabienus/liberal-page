# Bill & Committee Comboboxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a debounced search combobox to the Bills tab and a load-all combobox to the Committees tab in the Parliament Drawer, both alongside the existing URL-paste input.

**Architecture:** Bills use a server-side debounced search against the Knesset OData API (7,369 bills, returns top 20 matches). Committees use a load-all server-side list cached daily (≈200 items, client-side fuzzy filter). Both have dedicated `POST /api/bills/track` and `POST /api/committees/track` endpoints that bypass oknesset.org (which is currently unreachable) and write directly to the JSON data files. Both comboboxes live alongside the existing `AddTrackingInput` in the drawer tabs.

**Tech Stack:** Express, Knesset OData API, React 18, Vitest, Testing Library, TypeScript

---

## File Map

### Item 8 — Bills

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add `knessetUrl?: string` to `Bill`; add `BillSearchResult` interface |
| `server/routes/bills.ts` | Create | `GET /api/bills/search?q=` and `POST /api/bills/track` |
| `server/index.ts` | Modify | Register `/api/bills` router |
| `src/lib/api-client.ts` | Modify | Add `api.bills.search()` and `api.bills.track()` |
| `src/components/parliament/BillSearchCombobox.tsx` | Create | Debounced search input + dropdown |
| `src/components/parliament/BillCard.tsx` | Modify | Render `knessetUrl` link when present |
| `src/components/layout/ParliamentDrawer.tsx` | Modify | Add `BillSearchCombobox` to bills tab |
| `tests/server/bills-route.test.ts` | Create | Route tests |
| `tests/components/BillSearchCombobox.test.tsx` | Create | Component tests |

### Item 9 — Committees

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add `CommitteeListItem` interface |
| `server/repositories/committee-list-repository.ts` | Create | File-backed list cache (mirrors `MkListRepository`) |
| `server/routes/committees.ts` | Create | `GET /api/committees/list` and `POST /api/committees/track` |
| `server/index.ts` | Modify | Register `/api/committees` router |
| `src/lib/api-client.ts` | Modify | Add `api.committees.list()` and `api.committees.track()` |
| `src/hooks/useCommitteeList.ts` | Create | Session-cached hook (mirrors `useMkList`) |
| `src/components/parliament/CommitteeCombobox.tsx` | Create | Load-all fuzzy combobox (mirrors `MkCombobox`) |
| `src/components/layout/ParliamentDrawer.tsx` | Modify | Add `CommitteeCombobox` to committees tab |
| `src/data/knesset-committees-cache.json` | Gitignore | Auto-generated daily cache |
| `tests/server/committees-route.test.ts` | Create | Route tests |
| `tests/components/CommitteeCombobox.test.tsx` | Create | Component tests |

---

## ITEM 8: BILLS

---

## Task 1: Add `BillSearchResult` type and `knessetUrl` to `Bill`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add types to `src/types.ts`**

After the `Bill` interface, add `knessetUrl?: string` to the interface body. After the closing brace, append:

```typescript
// Bill interface change — add optional field:
// knessetUrl?: string  ← add inside the existing Bill interface

export interface BillSearchResult {
  billId: number
  name: string
  knessetUrl: string
}
```

The complete updated `Bill` interface (add `knessetUrl` before `hasNewData`):

```typescript
export interface Bill {
  id: number
  oknesset_id: string
  number: string
  title: string
  status: 'בוועדה' | 'הצבעה קרובה' | 'עבר' | 'נדחה'
  position: 'תומכים' | 'מתנגדים' | 'עוקבים'
  notes: string
  committee: string
  sourceUrl: string
  documentUrl: string | null
  knessetUrl?: string
  hasNewData: boolean
  lastPolledAt: string | null
}
```

- [ ] **Step 2: Run tests to confirm no breakage**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/types.ts
git commit -m "feat: add knessetUrl to Bill type and BillSearchResult interface"
```

---

## Task 2: `GET /api/bills/search` and `POST /api/bills/track` Routes

**Files:**
- Create: `server/routes/bills.ts`
- Create: `tests/server/bills-route.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/bills-route.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')
vi.stubGlobal('fetch', vi.fn())

import billsRouter from '../../server/routes/bills'

const app = express()
app.use(express.json())
app.use('/api/bills', billsRouter)

const ODATA_BILLS = [
  { BillID: 1038990, Name: 'הצעת חוק חופש העיסוק, התשפ"ו-2026', StatusID: 141 },
  { BillID: 1040059, Name: 'הצעת חוק חינוך חופשי, התשפ"ה-2025', StatusID: 141 },
]

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

describe('GET /api/bills/search', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(writeFile).mockResolvedValue()
  })

  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/bills/search')
    expect(res.status).toBe(400)
  })

  it('returns 400 when q is fewer than 3 chars', async () => {
    const res = await request(app).get('/api/bills/search?q=חו')
    expect(res.status).toBe(400)
  })

  it('returns 200 with bill search results for valid query', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(ODATA_BILLS))
    const res = await request(app).get('/api/bills/search?q=חופש')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].billId).toBe(1038990)
    expect(res.body[0].name).toBe('הצעת חוק חופש העיסוק, התשפ"ו-2026')
    expect(res.body[0].knessetUrl).toContain('1038990')
  })
})

describe('POST /api/bills/track', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    vi.mocked(writeFile).mockResolvedValue()
  })

  it('returns 400 when billId or name is missing', async () => {
    const res = await request(app).post('/api/bills/track').send({ name: 'test' })
    expect(res.status).toBe(400)
  })

  it('returns 200 and writes bill to data file', async () => {
    const res = await request(app).post('/api/bills/track').send({
      billId: 1038990,
      name: 'הצעת חוק חופש העיסוק',
      knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
    const [, content] = vi.mocked(writeFile).mock.calls[0]
    const written = JSON.parse(content as string)
    expect(written[0].title).toBe('הצעת חוק חופש העיסוק')
    expect(written[0].knessetUrl).toContain('1038990')
  })

  it('skips duplicate billId', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([
      { id: 1, oknesset_id: '', knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990', title: 'existing', number: '', status: 'בוועדה', position: 'עוקבים', notes: '', committee: '', sourceUrl: '', documentUrl: null, hasNewData: false, lastPolledAt: null }
    ]) as never)
    const res = await request(app).post('/api/bills/track').send({
      billId: 1038990,
      name: 'הצעת חוק חופש העיסוק',
      knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990',
    })
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- bills-route
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/routes/bills.ts`**

```typescript
import { Router } from 'express'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { Bill, BillSearchResult } from '../../src/types'

const router = Router()
const DATA_PATH = path.join(process.cwd(), 'src/data/bills.json')
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const CURRENT_KNESSET = 25

async function readBills(): Promise<Bill[]> {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8')
    return JSON.parse(raw as string) as Bill[]
  } catch {
    return []
  }
}

async function writeBills(bills: Bill[]): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(bills, null, 2), 'utf-8')
}

router.get('/search', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim() ?? ''
  if (q.length < 3) return res.status(400).json({ error: 'Query must be at least 3 characters' })

  try {
    const encoded = encodeURIComponent(q)
    const url = `${ODATA_BASE}/KNS_Bill?$filter=KnessetNum%20eq%20${CURRENT_KNESSET}%20and%20substringof('${encoded}',Name)&$top=20&$select=BillID,Name,StatusID&$format=json`
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`OData error ${response.status}`)
    const data = await response.json() as { value: Array<{ BillID: number; Name: string; StatusID: number }> }

    const results: BillSearchResult[] = (data.value ?? []).map((b) => ({
      billId: b.BillID,
      name: b.Name.trim(),
      knessetUrl: `https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=${CURRENT_KNESSET}&hql_id=${b.BillID}`,
    }))
    res.json(results)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.post('/track', async (req, res) => {
  const { billId, name, knessetUrl } = req.body as { billId?: number; name?: string; knessetUrl?: string }
  if (!billId || !name) return res.status(400).json({ error: 'billId and name required' })

  const bills = await readBills()
  const alreadyTracked = bills.some((b) => b.knessetUrl?.includes(`hql_id=${billId}`))
  if (alreadyTracked) return res.json({ ok: true, duplicate: true })

  const nextId = Math.max(0, ...bills.map((b) => b.id)) + 1
  const newBill: Bill = {
    id: nextId,
    oknesset_id: '',
    number: String(billId),
    title: name.trim(),
    status: 'בוועדה',
    position: 'עוקבים',
    notes: '',
    committee: '',
    sourceUrl: knessetUrl ?? '',
    knessetUrl: knessetUrl,
    documentUrl: null,
    hasNewData: false,
    lastPolledAt: null,
  }
  bills.push(newBill)
  await writeBills(bills)
  res.json({ ok: true, item: newBill })
})

export default router
```

- [ ] **Step 4: Register in `server/index.ts`**

Add after the existing imports:
```typescript
import billsRouter from './routes/bills'
```

Add after `app.use('/api/parliament', parliamentRouter)`:
```typescript
app.use('/api/bills', billsRouter)
```

- [ ] **Step 5: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- bills-route
```

Expected: all tests PASS.

- [ ] **Step 6: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add server/routes/bills.ts server/index.ts tests/server/bills-route.test.ts
git commit -m "feat: add GET /api/bills/search and POST /api/bills/track routes"
```

---

## Task 3: `api-client.ts` additions for bills + `BillCard` link

**Files:**
- Modify: `src/lib/api-client.ts`
- Modify: `src/components/parliament/BillCard.tsx`

- [ ] **Step 1: Update `src/lib/api-client.ts`**

Add `BillSearchResult` to the type import line:
```typescript
import type { Bill, Committee, Mk, TrackingType, KnessetMember, MkActivity, BillSearchResult } from '@/types'
```

Add to the `api` export object:
```typescript
  bills: {
    search: (q: string) => apiFetch<BillSearchResult[]>(`/bills/search?q=${encodeURIComponent(q)}`),
    track: (billId: number, name: string, knessetUrl: string) =>
      apiFetch<{ ok: boolean; duplicate?: boolean; item?: Bill }>('/bills/track', {
        method: 'POST',
        body: JSON.stringify({ billId, name, knessetUrl }),
      }),
  },
```

- [ ] **Step 2: Read and update `src/components/parliament/BillCard.tsx`**

Read the current file to find where the source link is rendered, then add a `knessetUrl` link alongside it. In the footer area of the card, after the existing sourceUrl link, add:

```typescript
{bill.knessetUrl && (
  <a
    href={bill.knessetUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-primary hover:underline"
  >
    {t('tracker.view_source')} ↗
  </a>
)}
```

- [ ] **Step 3: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/lib/api-client.ts src/components/parliament/BillCard.tsx
git commit -m "feat: add bills api client methods and knessetUrl link in BillCard"
```

---

## Task 4: `BillSearchCombobox` Component

**Files:**
- Create: `src/components/parliament/BillSearchCombobox.tsx`
- Create: `tests/components/BillSearchCombobox.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/BillSearchCombobox.test.tsx`:

```typescript
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: {
    bills: {
      search: vi.fn(),
      track: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
}))

import BillSearchCombobox from '@/components/parliament/BillSearchCombobox'
import { api } from '@/lib/api-client'

const RESULTS = [
  { billId: 1038990, name: 'הצעת חוק חופש העיסוק', knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990' },
  { billId: 1040059, name: 'הצעת חוק חינוך חופשי', knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1040059' },
]

describe('BillSearchCombobox', () => {
  beforeEach(() => {
    vi.mocked(api.bills.search).mockResolvedValue(RESULTS)
    vi.mocked(api.bills.track).mockResolvedValue({ ok: true })
  })

  it('renders the search placeholder', () => {
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    expect(screen.getByPlaceholderText(/חפש הצ"ח/i)).toBeInTheDocument()
  })

  it('does not search when fewer than 3 chars typed', async () => {
    const user = userEvent.setup()
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חו')
    expect(api.bills.search).not.toHaveBeenCalled()
  })

  it('shows results after 3+ chars (debounce bypassed in test)', async () => {
    const user = userEvent.setup({ delay: null })
    render(<BillSearchCombobox onAdd={vi.fn()} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חופש')
    // Advance timers past the 300ms debounce
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    expect(api.bills.search).toHaveBeenCalledWith('חופש')
    expect(await screen.findByText('הצעת חוק חופש העיסוק')).toBeInTheDocument()
  })

  it('calls api.bills.track and onAdd when a result is clicked', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup({ delay: null })
    render(<BillSearchCombobox onAdd={onAdd} />)
    await user.type(screen.getByPlaceholderText(/חפש הצ"ח/i), 'חופש')
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })
    await user.click(await screen.findByText('הצעת חוק חופש העיסוק'))
    expect(api.bills.track).toHaveBeenCalledWith(
      1038990,
      'הצעת חוק חופש העיסוק',
      expect.stringContaining('1038990')
    )
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- BillSearchCombobox
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/components/parliament/BillSearchCombobox.tsx`**

```typescript
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api-client'
import type { BillSearchResult } from '@/types'

interface BillSearchComboboxProps {
  onAdd: () => void
}

export default function BillSearchCombobox({ onAdd }: BillSearchComboboxProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BillSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Debounced search — fires 300ms after last keystroke, min 3 chars
  useEffect(() => {
    if (query.length < 3) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.bills.search(query)
        setResults(data)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const handleSelect = async (result: BillSearchResult) => {
    setOpen(false)
    setQuery('')
    setResults([])
    await api.bills.track(result.billId, result.name, result.knessetUrl).catch(() => {/* ignore */})
    onAdd()
  }

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <div className="relative">
        <input
          className="w-full rounded-md border border-border bg-blue-50 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={`${t('tracker.tab_bill')} — חפש הצ"ח לפי כותרת...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          dir="rtl"
        />
        {loading && (
          <div className="absolute left-2 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          <div className="max-h-60 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.billId}
                type="button"
                className="flex w-full flex-col px-3 py-2 text-start hover:bg-slate-50"
                onClick={() => handleSelect(r)}
              >
                <span className="text-sm leading-snug">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.billId}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- BillSearchCombobox
```

Expected: 4 PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/components/parliament/BillSearchCombobox.tsx tests/components/BillSearchCombobox.test.tsx
git commit -m "feat: add BillSearchCombobox with debounced OData search"
```

---

## Task 5: Add `BillSearchCombobox` to Parliament Drawer Bills Tab

**Files:**
- Modify: `src/components/layout/ParliamentDrawer.tsx`

- [ ] **Step 1: Add import**

In `src/components/layout/ParliamentDrawer.tsx`, add after the existing parliament imports:

```typescript
import BillSearchCombobox from '@/components/parliament/BillSearchCombobox'
```

- [ ] **Step 2: Add combobox to bills tab**

Find the `<TabsContent value="bills" ...>` block. Add `<BillSearchCombobox onAdd={onAdd} />` as the first element inside it, before the `bills.map(...)`:

```typescript
<TabsContent value="bills" className="m-0 space-y-3 p-4">
  <BillSearchCombobox onAdd={onAdd} />
  {bills.map((bill) => (
    <BillCard key={bill.id} bill={bill} onRemove={onRemoveBill} />
  ))}
  {bills.length === 0 && (
    <p className="py-8 text-right text-sm text-muted-foreground">{t('ui.drawer_empty_bills')}</p>
  )}
</TabsContent>
```

- [ ] **Step 3: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/components/layout/ParliamentDrawer.tsx
git commit -m "feat: add BillSearchCombobox to parliament drawer bills tab"
```

---

## ITEM 9: COMMITTEES

---

## Task 6: `CommitteeListRepository` + `GET /api/committees/list` and `POST /api/committees/track`

**Files:**
- Create: `server/repositories/committee-list-repository.ts`
- Create: `server/routes/committees.ts`
- Create: `tests/server/committees-route.test.ts`
- Modify: `server/index.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Add `CommitteeListItem` to `src/types.ts`**

After `BillSearchResult`, add:

```typescript
export interface CommitteeListItem {
  committeeId: number
  name: string
  knessetUrl: string
}
```

- [ ] **Step 2: Add `knesset-committees-cache.json` to `.gitignore`**

```
src/data/knesset-committees-cache.json
```

- [ ] **Step 3: Implement `server/repositories/committee-list-repository.ts`**

```typescript
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { CommitteeListItem } from '../../src/types'

interface CacheFile {
  cachedAt: string
  committees: CommitteeListItem[]
}

const CACHE_PATH = path.join(process.cwd(), 'src/data/knesset-committees-cache.json')

export class CommitteeListRepository {
  private cachedAt = 0

  async get(): Promise<CommitteeListItem[] | null> {
    try {
      const raw = await readFile(CACHE_PATH, 'utf-8')
      const data = JSON.parse(raw as string) as CacheFile
      this.cachedAt = new Date(data.cachedAt).getTime()
      return data.committees
    } catch {
      return null
    }
  }

  async set(committees: CommitteeListItem[]): Promise<void> {
    const cachedAt = new Date().toISOString()
    this.cachedAt = Date.now()
    await writeFile(CACHE_PATH, JSON.stringify({ cachedAt, committees }, null, 2), 'utf-8')
  }

  getAgeMs(): number {
    return this.cachedAt ? Date.now() - this.cachedAt : Infinity
  }
}
```

- [ ] **Step 4: Write failing tests**

Create `tests/server/committees-route.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')
vi.stubGlobal('fetch', vi.fn())
vi.mock('../../server/repositories/committee-list-repository', () => ({
  CommitteeListRepository: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getAgeMs: vi.fn().mockReturnValue(Infinity),
  })),
}))

import committeesRouter from '../../server/routes/committees'

const app = express()
app.use(express.json())
app.use('/api/committees', committeesRouter)

const ODATA_COMMITTEES = [
  { CommitteeID: 2, Name: 'ועדת הכספים' },
  { CommitteeID: 3, Name: 'ועדת החוץ והביטחון' },
]

function mockOdata(value: unknown[], nextLink?: string) {
  const body: Record<string, unknown> = { value }
  if (nextLink) body['odata.nextLink'] = nextLink
  return { ok: true, json: async () => body } as Response
}

describe('GET /api/committees/list', () => {
  beforeEach(() => vi.mocked(fetch).mockReset())

  it('returns 200 with committee list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(ODATA_COMMITTEES))
    const res = await request(app).get('/api/committees/list')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].committeeId).toBe(2)
    expect(res.body[0].name).toBe('ועדת הכספים')
    expect(res.body[0].knessetUrl).toContain('2')
  })
})

describe('POST /api/committees/track', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    vi.mocked(writeFile).mockResolvedValue()
  })

  it('returns 400 when committeeId or name is missing', async () => {
    const res = await request(app).post('/api/committees/track').send({ name: 'test' })
    expect(res.status).toBe(400)
  })

  it('returns 200 and writes committee to data file', async () => {
    const res = await request(app).post('/api/committees/track').send({
      committeeId: 2,
      name: 'ועדת הכספים',
      knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
  })

  it('skips duplicate committeeId', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([
      { id: 1, oknesset_id: '2', name: 'existing', chair: '', lastSessionDate: null, lastSessionSummary: null, lastSessionDocumentUrl: null, sourceUrl: '', hasNewData: false, lastPolledAt: null }
    ]) as never)
    const res = await request(app).post('/api/committees/track').send({
      committeeId: 2,
      name: 'ועדת הכספים',
      knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2',
    })
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- committees-route
```

Expected: FAIL.

- [ ] **Step 6: Implement `server/routes/committees.ts`**

```typescript
import { Router } from 'express'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { Committee, CommitteeListItem } from '../../src/types'
import { CommitteeListRepository } from '../repositories/committee-list-repository'

const router = Router()
const DATA_PATH = path.join(process.cwd(), 'src/data/committees.json')
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const repo = new CommitteeListRepository()

async function odataFetchAll<T>(path: string): Promise<T[]> {
  const results: T[] = []
  let nextPath: string | null = path
  while (nextPath) {
    const res = await fetch(`${ODATA_BASE}/${nextPath}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`OData error ${res.status}`)
    const data = await res.json() as { value?: T[]; 'odata.nextLink'?: string }
    results.push(...(data.value ?? []))
    nextPath = data['odata.nextLink'] ?? null
  }
  return results
}

async function readCommittees(): Promise<Committee[]> {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8')
    return JSON.parse(raw as string) as Committee[]
  } catch {
    return []
  }
}

router.get('/list', async (_req, res) => {
  try {
    const cached = await repo.get()
    if (cached && repo.getAgeMs() < CACHE_TTL_MS) return res.json(cached)

    const raw = await odataFetchAll<{ CommitteeID: number; Name: string }>(
      `KNS_Committee?$filter=IsCurrent%20eq%20true&$select=CommitteeID,Name&$top=200&$format=json`
    )
    const committees: CommitteeListItem[] = raw.map((c) => ({
      committeeId: c.CommitteeID,
      name: c.Name.trim(),
      knessetUrl: `https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=${c.CommitteeID}`,
    }))
    await repo.set(committees)
    res.json(committees)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.post('/track', async (req, res) => {
  const { committeeId, name, knessetUrl } = req.body as { committeeId?: number; name?: string; knessetUrl?: string }
  if (!committeeId || !name) return res.status(400).json({ error: 'committeeId and name required' })

  const committees = await readCommittees()
  const alreadyTracked = committees.some((c) => c.oknesset_id === String(committeeId))
  if (alreadyTracked) return res.json({ ok: true, duplicate: true })

  const nextId = Math.max(0, ...committees.map((c) => c.id)) + 1
  const newCommittee: Committee = {
    id: nextId,
    oknesset_id: String(committeeId),
    name: name.trim(),
    chair: '',
    lastSessionDate: null,
    lastSessionSummary: null,
    lastSessionDocumentUrl: null,
    sourceUrl: knessetUrl ?? '',
    hasNewData: false,
    lastPolledAt: null,
  }
  committees.push(newCommittee)
  await writeFile(DATA_PATH, JSON.stringify(committees, null, 2), 'utf-8')
  res.json({ ok: true, item: newCommittee })
})

export default router
```

- [ ] **Step 7: Register in `server/index.ts`**

Add import: `import committeesRouter from './routes/committees'`

Add route: `app.use('/api/committees', committeesRouter)` after the bills line.

- [ ] **Step 8: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- committees-route
```

Expected: all PASS.

- [ ] **Step 9: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add server/repositories/committee-list-repository.ts server/routes/committees.ts server/index.ts .gitignore src/types.ts tests/server/committees-route.test.ts
git commit -m "feat: add CommitteeListRepository and GET/POST /api/committees routes"
```

---

## Task 7: `api-client.ts` additions for committees + `useCommitteeList` hook

**Files:**
- Modify: `src/lib/api-client.ts`
- Create: `src/hooks/useCommitteeList.ts`
- Create: `tests/unit/useCommitteeList.test.ts`

- [ ] **Step 1: Update `src/lib/api-client.ts`**

Add `CommitteeListItem` to the import line. Add to the `api` object:

```typescript
  committees: {
    list: () => apiFetch<CommitteeListItem[]>('/committees/list'),
    track: (committeeId: number, name: string, knessetUrl: string) =>
      apiFetch<{ ok: boolean; duplicate?: boolean }>('/committees/track', {
        method: 'POST',
        body: JSON.stringify({ committeeId, name, knessetUrl }),
      }),
  },
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/useCommitteeList.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({
  api: { committees: { list: vi.fn() } },
}))

import { useCommitteeList } from '@/hooks/useCommitteeList'
import { api } from '@/lib/api-client'

const COMMITTEES = [
  { committeeId: 2, name: 'ועדת הכספים', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2' },
]

describe('useCommitteeList', () => {
  beforeEach(() => {
    vi.mocked(api.committees.list).mockResolvedValue(COMMITTEES)
    vi.resetModules()
  })

  it('returns loading:true initially', () => {
    const { result } = renderHook(() => useCommitteeList())
    expect(result.current.loading).toBe(true)
  })

  it('returns committees after fetch resolves', async () => {
    const { result } = renderHook(() => useCommitteeList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.committees).toHaveLength(1)
    expect(result.current.committees[0].committeeId).toBe(2)
  })

  it('returns error on fetch failure', async () => {
    vi.mocked(api.committees.list).mockRejectedValueOnce(new Error('network error'))
    const { result } = renderHook(() => useCommitteeList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network error')
  })
})
```

- [ ] **Step 3: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- useCommitteeList
```

Expected: FAIL.

- [ ] **Step 4: Implement `src/hooks/useCommitteeList.ts`**

```typescript
import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { CommitteeListItem } from '@/types'

let sessionCache: CommitteeListItem[] | null = null

export function useCommitteeList() {
  const [committees, setCommittees] = useState<CommitteeListItem[]>(sessionCache ?? [])
  const [loading, setLoading] = useState(sessionCache === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionCache !== null) return
    api.committees.list()
      .then((data) => {
        sessionCache = data
        setCommittees(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return { committees, loading, error }
}
```

- [ ] **Step 5: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- useCommitteeList
```

Expected: 3 PASS.

- [ ] **Step 6: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/lib/api-client.ts src/hooks/useCommitteeList.ts tests/unit/useCommitteeList.test.ts
git commit -m "feat: add committees api client methods and useCommitteeList hook"
```

---

## Task 8: `CommitteeCombobox` Component + Add to Drawer

**Files:**
- Create: `src/components/parliament/CommitteeCombobox.tsx`
- Create: `tests/components/CommitteeCombobox.test.tsx`
- Modify: `src/components/layout/ParliamentDrawer.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/CommitteeCombobox.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/hooks/useCommitteeList', () => ({
  useCommitteeList: () => ({
    committees: [
      { committeeId: 2, name: 'ועדת הכספים', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2' },
      { committeeId: 3, name: 'ועדת החוץ והביטחון', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=3' },
    ],
    loading: false,
    error: null,
  }),
}))
vi.mock('@/lib/api-client', () => ({
  api: { committees: { track: vi.fn().mockResolvedValue({ ok: true }) } },
}))

import CommitteeCombobox from '@/components/parliament/CommitteeCombobox'
import { api } from '@/lib/api-client'

describe('CommitteeCombobox', () => {
  beforeEach(() => vi.mocked(api.committees.track).mockResolvedValue({ ok: true }))

  it('renders search placeholder', () => {
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    expect(screen.getByText(/חפש ועדה/i)).toBeInTheDocument()
  })

  it('opens dropdown and shows committees on click', async () => {
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
    expect(screen.getByText('ועדת החוץ והביטחון')).toBeInTheDocument()
  })

  it('filters by name when typing', async () => {
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    await user.type(screen.getByPlaceholderText(/חפש ועדה/i), 'כספים')
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
    expect(screen.queryByText('ועדת החוץ והביטחון')).not.toBeInTheDocument()
  })

  it('calls api.committees.track and onAdd when item clicked', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={onAdd} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    await user.click(screen.getByText('ועדת הכספים'))
    expect(api.committees.track).toHaveBeenCalledWith(
      2,
      'ועדת הכספים',
      expect.stringContaining('commmid=2')
    )
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- CommitteeCombobox
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/components/parliament/CommitteeCombobox.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCommitteeList } from '@/hooks/useCommitteeList'
import { api } from '@/lib/api-client'
import type { CommitteeListItem } from '@/types'

interface CommitteeComboboxProps {
  onAdd: () => void
}

export default function CommitteeCombobox({ onAdd }: CommitteeComboboxProps) {
  const { t } = useTranslation()
  const { committees, loading } = useCommitteeList()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = committees.filter((c) =>
    !query || c.name.toLowerCase().includes(query.toLowerCase())
  )

  const handleSelect = async (item: CommitteeListItem) => {
    setOpen(false)
    setQuery('')
    await api.committees.track(item.committeeId, item.name, item.knessetUrl).catch(() => {/* ignore */})
    onAdd()
  }

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-blue-50 px-3 py-2 text-start"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex-1 text-sm text-muted-foreground">
          {t('ui.drawer_committees_tab')} — חפש ועדה...
        </span>
        <span className="text-xs text-muted-foreground">▼</span>
      </button>

      {open && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              className="w-full text-sm outline-none"
              placeholder="חפש ועדה..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              dir="rtl"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading && <div className="p-4 text-center text-sm text-muted-foreground">...</div>}
            {filtered.map((c) => (
              <button
                key={c.committeeId}
                type="button"
                className="flex w-full items-center px-3 py-2 text-start text-sm hover:bg-slate-50"
                onClick={() => handleSelect(c)}
              >
                {c.name}
              </button>
            ))}
            {!loading && filtered.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">לא נמצאו תוצאות</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add to Parliament Drawer**

In `src/components/layout/ParliamentDrawer.tsx`, add import:
```typescript
import CommitteeCombobox from '@/components/parliament/CommitteeCombobox'
```

Find the `<TabsContent value="committees" ...>` block and add `<CommitteeCombobox onAdd={onAdd} />` as the first element:

```typescript
<TabsContent value="committees" className="m-0 space-y-3 p-4">
  <CommitteeCombobox onAdd={onAdd} />
  {committees.map((c) => (
    <CommitteeCard key={c.id} committee={c} onRemove={onRemoveCommittee} />
  ))}
  {committees.length === 0 && (
    <p className="py-8 text-right text-sm text-muted-foreground">{t('ui.drawer_empty_committees')}</p>
  )}
</TabsContent>
```

- [ ] **Step 5: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- CommitteeCombobox
```

Expected: 4 PASS.

- [ ] **Step 6: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/components/parliament/CommitteeCombobox.tsx tests/components/CommitteeCombobox.test.tsx src/components/layout/ParliamentDrawer.tsx
git commit -m "feat: add CommitteeCombobox to parliament drawer committees tab"
```

---

## Task 9: Final Verification + Merge

- [ ] **Step 1: Run full test suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Smoke test manually**

```bash
npm run dev
```

Open `http://localhost:5173` and verify:
1. Open Parliament Drawer → Bills tab → `BillSearchCombobox` visible above `AddTrackingInput`
2. Type "חינוך" (3+ chars) → wait 300ms → dropdown appears with matching Knesset 25 bills
3. Select a bill → it appears in the bills list below
4. Open Committees tab → `CommitteeCombobox` visible above `AddTrackingInput`
5. Click dropdown → ~200 committees load → type "כספים" → filters to finance committee
6. Select a committee → it appears in the committees list below

- [ ] **Step 3: Merge to master**

```bash
cd /home/aavitan/claude-projects/liberal-page
git checkout master
git merge <worktree-branch> --no-edit
```
