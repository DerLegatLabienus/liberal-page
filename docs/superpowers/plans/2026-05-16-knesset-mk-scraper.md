# Knesset MK Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `knesset-scraper.ts` module that fetches real MK activity (bills + parliamentary questions, newest first) from Knesset OData and integrates it into the tracking route and poller.

**Architecture:** A new `server/services/knesset-scraper.ts` fetches bills via `KNS_BillInitiator` and questions via `KNS_Query` in parallel, merges and sorts by date descending, and returns `MkActivity[]`. The tracking route calls it on add; the poller calls it on refresh. `mks.json` is the persistent store — hand-crafted activity items are removed but MK records remain.

**Tech Stack:** TypeScript, Knesset OData API (`knesset.gov.il/Odata/ParliamentInfo.svc`), Vitest (Node environment), existing `MkActivity` type in `src/types.ts`.

---

## File Map

```
server/services/knesset-scraper.ts   NEW — fetchMkActivity(), fetchMkBills(), fetchMkQuestions()
tests/server/knesset-scraper.test.ts NEW — unit tests with mocked fetch
src/types.ts                         MODIFY — add 'question' to MkActivityType
server/routes/tracking.ts            MODIFY — call fetchMkActivity on MK add
server/services/poller.ts            MODIFY — replace pollMks() with Knesset OData version
src/data/mks.json                    MODIFY — remove hand-crafted activity[], keep MK records
src/components/parliament/MkCard.tsx MODIFY — add 📜 question icon to ACTIVITY_ICONS
```

---

### Task 1: Add `'question'` to `MkActivityType`

**Files:**
- Modify: `src/types.ts:46`

- [ ] **Step 1.1: Update the type**

Open `src/types.ts` and change line 46:

```ts
export type MkActivityType = 'bill_initiated' | 'vote' | 'duty_change' | 'question'
```

- [ ] **Step 1.2: Verify TypeScript is still clean**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | head -5
```

Expected: no output (zero errors).

- [ ] **Step 1.3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add 'question' to MkActivityType"
```

---

### Task 2: Create `knesset-scraper.ts` with TDD

**Files:**
- Create: `server/services/knesset-scraper.ts`
- Create: `tests/server/knesset-scraper.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Create `tests/server/knesset-scraper.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { fetchMkActivity } from '../../server/services/knesset-scraper'

const BILLS_RESPONSE = {
  value: [
    {
      BillInitiatorID: 1,
      BillID: 100,
      PersonID: 30839,
      IsInitiator: true,
      LastUpdatedDate: '2026-03-29T00:00:00',
      KNS_Bill: {
        BillID: 100,
        Name: 'הצעת חוק חכירה הוגנת, התשפ"ד-2024',
        SubTypeDesc: 'פרטית',
        KnessetNum: 25,
      },
    },
    {
      BillInitiatorID: 2,
      BillID: 101,
      PersonID: 30839,
      IsInitiator: true,
      LastUpdatedDate: '2024-01-01T00:00:00',
      KNS_Bill: {
        BillID: 101,
        Name: 'הצעת חוק ישנה, התשפ"ד-2024',
        SubTypeDesc: 'פרטית',
        KnessetNum: 25,
      },
    },
  ],
}

const QUESTIONS_RESPONSE = {
  value: [
    {
      QueryID: 999,
      Name: 'קיצוץ התקציב לאולפני השוברים',
      TypeDesc: 'רגילה',
      SubmitDate: '2024-04-01T17:12:03.074',
    },
  ],
}

describe('fetchMkActivity', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  it('returns bills and questions merged and sorted newest first', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => BILLS_RESPONSE } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => QUESTIONS_RESPONSE } as Response)

    const result = await fetchMkActivity(30839, 10)

    expect(result).toHaveLength(3)
    expect(result[0].date).toBe('2026-03-29T00:00:00')
    expect(result[0].type).toBe('bill_initiated')
    expect(result[0].title).toBe('הצעת חוק חכירה הוגנת, התשפ"ד-2024')
    expect(result[1].date).toBe('2024-04-01T17:12:03.074')
    expect(result[1].type).toBe('question')
    expect(result[2].date).toBe('2024-01-01T00:00:00')
    expect(result[2].type).toBe('bill_initiated')
  })

  it('respects the limit parameter', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => BILLS_RESPONSE } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => QUESTIONS_RESPONSE } as Response)

    const result = await fetchMkActivity(30839, 2)
    expect(result).toHaveLength(2)
  })

  it('returns partial results when questions endpoint fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => BILLS_RESPONSE } as Response)
      .mockRejectedValueOnce(new Error('network error'))

    const result = await fetchMkActivity(30839, 10)
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.type === 'bill_initiated')).toBe(true)
  })

  it('returns empty array when both endpoints fail', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))

    const result = await fetchMkActivity(30839, 10)
    expect(result).toEqual([])
  })

  it('each bill activity has a sourceUrl with BillID', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => BILLS_RESPONSE } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) } as Response)

    const result = await fetchMkActivity(30839, 10)
    expect(result[0].sourceUrl).toContain('100')
  })

  it('each question activity has a sourceUrl with QueryID', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => QUESTIONS_RESPONSE } as Response)

    const result = await fetchMkActivity(30839, 10)
    expect(result[0].sourceUrl).toContain('999')
  })
})
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
npm test -- tests/server/knesset-scraper.test.ts 2>&1 | tail -8
```

Expected: FAIL — `Cannot find module '../../server/services/knesset-scraper'`

- [ ] **Step 2.3: Create `server/services/knesset-scraper.ts`**

```ts
import type { MkActivity } from '../../src/types'

const BILLS_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

interface KNS_BillInitiatorRecord {
  BillInitiatorID: number
  BillID: number
  PersonID: number
  IsInitiator: boolean
  LastUpdatedDate: string
  KNS_Bill: {
    BillID: number
    Name: string
    SubTypeDesc: string
    KnessetNum: number
  }
}

interface KNS_QueryRecord {
  QueryID: number
  Name: string
  TypeDesc: string
  SubmitDate: string
}

async function fetchJson<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Knesset OData error ${res.status}`)
  const data = await res.json() as { value?: T[] }
  return data.value ?? []
}

async function fetchMkBills(knsId: number): Promise<MkActivity[]> {
  const url =
    `${BILLS_BASE}/KNS_BillInitiator` +
    `?$filter=PersonID%20eq%20${knsId}` +
    `&$expand=KNS_Bill` +
    `&$orderby=LastUpdatedDate%20desc` +
    `&$top=20` +
    `&$format=json`

  const records = await fetchJson<KNS_BillInitiatorRecord>(url)
  return records
    .filter((r) => r.KNS_Bill?.Name)
    .map((r) => ({
      type: 'bill_initiated' as const,
      date: r.LastUpdatedDate,
      title: r.KNS_Bill.Name,
      detail: r.KNS_Bill.SubTypeDesc ?? undefined,
      sourceUrl:
        `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx` +
        `?t=lawsuggestionssearch&lawitemid=${r.BillID}`,
    }))
}

async function fetchMkQuestions(knsId: number): Promise<MkActivity[]> {
  const url =
    `${BILLS_BASE}/KNS_Query` +
    `?$filter=PersonID%20eq%20${knsId}` +
    `&$orderby=SubmitDate%20desc` +
    `&$top=10` +
    `&$format=json`

  const records = await fetchJson<KNS_QueryRecord>(url)
  return records
    .filter((r) => r.Name)
    .map((r) => ({
      type: 'question' as const,
      date: r.SubmitDate,
      title: r.Name,
      detail: r.TypeDesc ?? undefined,
      sourceUrl:
        `${BILLS_BASE}/KNS_Query(${r.QueryID})`,
    }))
}

/**
 * Fetch MK activity (bills initiated + parliamentary questions)
 * from Knesset OData, merged and sorted newest first.
 *
 * @param knsId  Internal Knesset PersonID (KnsID)
 * @param limit  Max items to return (default 10)
 */
export async function fetchMkActivity(knsId: number, limit = 10): Promise<MkActivity[]> {
  const [billsResult, questionsResult] = await Promise.allSettled([
    fetchMkBills(knsId),
    fetchMkQuestions(knsId),
  ])

  const bills = billsResult.status === 'fulfilled' ? billsResult.value : []
  const questions = questionsResult.status === 'fulfilled' ? questionsResult.value : []

  return [...bills, ...questions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
npm test -- tests/server/knesset-scraper.test.ts 2>&1 | tail -10
```

Expected:
```
✓ tests/server/knesset-scraper.test.ts (6 tests)
Test Files  1 passed (1)
Tests       6 passed (6)
```

- [ ] **Step 2.5: Commit**

```bash
git add server/services/knesset-scraper.ts tests/server/knesset-scraper.test.ts
git commit -m "feat: add knesset-scraper module — fetchMkActivity (bills + questions, newest first)"
```

---

### Task 3: Wire scraper into tracking route

**Files:**
- Modify: `server/routes/tracking.ts`

- [ ] **Step 3.1: Add import**

At the top of `server/routes/tracking.ts`, add:

```ts
import { fetchMkActivity } from '../services/knesset-scraper'
```

- [ ] **Step 3.2: Update the knesset MK add case**

Find the block starting with `if (url && isKnessetSiteUrl(url)) {` and replace the entire `if (type === 'mk')` block with:

```ts
    if (type === 'mk') {
      const items = await readItems<Mk>('mk')
      const nextId = Math.max(0, ...items.map((i) => i.id)) + 1
      let newItem: Mk

      if (url && isKnessetSiteUrl(url)) {
        const siteId = parseInt(id, 10)
        const [identity, activity] = await Promise.all([
          getMkBySiteId(siteId),
          fetchMkActivity(parseInt(id, 10), 10).catch(() => []),
        ])
        newItem = {
          id: nextId,
          oknesset_id: String(identity.knsId),
          knesset_site_id: id,
          name: identity.name,
          party: identity.faction ?? '',
          email: identity.email ?? null,
          photoUrl: `https://main.knesset.gov.il/mk/members/${id}/photo`,
          currentRoles: identity.positions.map((p) => ({
            positionId: p.positionId,
            description: 'חבר כנסת',
            isCurrent: p.isCurrent,
            startDate: p.startDate,
          })),
          activity,
          recentVotes: [],
          votingSummary: null,
          sourceUrl: url,
          hasNewData: false,
          lastPolledAt: new Date().toISOString(),
        }
      } else {
        const data = await oknesset.getMk(id)
        newItem = {
          id: nextId,
          oknesset_id: id,
          name: data.name,
          party: data.party ?? '',
          activity: [],
          recentVotes: [],
          votingSummary: null,
          sourceUrl: url ?? '',
          hasNewData: false,
          lastPolledAt: null,
        }
      }

      items.push(newItem)
      await writeItems('mk', items)
      return res.json({ ok: true, item: newItem })
    }
```

Note: `fetchMkActivity` uses the `knsId` (internal PersonID), not the `siteId`. The identity lookup returns `knsId` via `getMkBySiteId`. Update the call to use `identity.knsId`:

```ts
```

Since `fetchMkActivity` needs `knsId` from identity, run them sequentially:

```ts
      if (url && isKnessetSiteUrl(url)) {
        const siteId = parseInt(id, 10)
        const identity = await getMkBySiteId(siteId)
        const activity = await fetchMkActivity(identity.knsId, 10).catch(() => [])
        newItem = {
          id: nextId,
          oknesset_id: String(identity.knsId),
          knesset_site_id: id,
          name: identity.name,
          party: identity.faction ?? '',
          email: identity.email ?? null,
          photoUrl: `https://main.knesset.gov.il/mk/members/${id}/photo`,
          currentRoles: identity.positions.map((p) => ({
            positionId: p.positionId,
            description: 'חבר כנסת',
            isCurrent: p.isCurrent,
            startDate: p.startDate,
          })),
          activity,
          recentVotes: [],
          votingSummary: null,
          sourceUrl: url,
          hasNewData: false,
          lastPolledAt: new Date().toISOString(),
        }
      }
```

- [ ] **Step 3.3: Start server and test the endpoint**

```bash
npm run dev:server &
sleep 3
curl -s -X POST http://localhost:3001/api/tracking/add \
  -H "Content-Type: application/json" \
  -d '{"url":"https://main.knesset.gov.il/mk/Apps/mk/mk-positions/1116"}' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
a = d.get('item', {}).get('activity', [])
print(f'Activity items: {len(a)}')
for item in a[:3]:
    print(f'  {item[\"date\"][:10]} [{item[\"type\"]}] {item[\"title\"][:50]}')
"
```

Expected: 3+ items, dates from 2024–2026, no 2022 bills.

- [ ] **Step 3.4: Commit**

```bash
git add server/routes/tracking.ts
git commit -m "feat: tracking route populates MK activity from knesset-scraper on add"
```

---

### Task 4: Replace `pollMks()` in poller

**Files:**
- Modify: `server/services/poller.ts`

- [ ] **Step 4.1: Add import at top of poller.ts**

```ts
import { fetchMkActivity } from './knesset-scraper'
```

- [ ] **Step 4.2: Replace the `pollMks` function entirely**

Find and replace the entire `async function pollMks()` function with:

```ts
async function pollMks(): Promise<void> {
  const mks = await readJson<Mk>('mks.json')
  let changed = false

  for (const mk of mks) {
    const knsId = mk.oknesset_id ? parseInt(mk.oknesset_id, 10) : 0
    if (!knsId) continue

    try {
      const fresh = await fetchMkActivity(knsId, 20)
      const existingUrls = new Set((mk.activity ?? []).map((a) => a.sourceUrl))
      const newItems = fresh.filter((a) => a.sourceUrl && !existingUrls.has(a.sourceUrl))

      if (newItems.length > 0) {
        mk.activity = [...newItems, ...(mk.activity ?? [])].slice(0, 20)
        mk.hasNewData = true
        changed = true
      }
    } catch (err) {
      console.error(`Poller: error polling MK ${mk.oknesset_id}:`, err)
    }

    mk.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('mks.json', mks)
}
```

- [ ] **Step 4.3: Run full test suite to confirm nothing broke**

```bash
npm test 2>&1 | grep -E "Test Files|Tests|passed|failed"
```

Expected:
```
Test Files  7 passed (7)
Tests       31 passed (31)
```

- [ ] **Step 4.4: Commit**

```bash
git add server/services/poller.ts
git commit -m "feat: replace pollMks with Knesset OData scraper (bills + questions, change detection by sourceUrl)"
```

---

### Task 5: Clean `mks.json` — remove hand-crafted activity

**Files:**
- Modify: `src/data/mks.json`

- [ ] **Step 5.1: Update mks.json**

Replace the contents of `src/data/mks.json` with:

```json
[
  {
    "id": 1,
    "oknesset_id": "30839",
    "knesset_site_id": "1116",
    "name": "דן אילוז",
    "party": "הליכוד",
    "email": "hak_diluz@knesset.gov.il",
    "photoUrl": "https://main.knesset.gov.il/mk/members/1116/photo",
    "currentRoles": [
      {
        "positionId": 54,
        "description": "חבר כנסת",
        "factionName": "הליכוד",
        "isCurrent": true,
        "startDate": "2023-01-06T00:00:00"
      }
    ],
    "activity": [],
    "recentVotes": [],
    "votingSummary": null,
    "sourceUrl": "https://main.knesset.gov.il/mk/Apps/mk/mk-positions/1116",
    "hasNewData": false,
    "lastPolledAt": null
  },
  {
    "id": 2,
    "oknesset_id": "30870",
    "knesset_site_id": "1117",
    "name": "משה רוט",
    "party": "יהדות התורה",
    "email": null,
    "photoUrl": "https://main.knesset.gov.il/mk/members/1117/photo",
    "currentRoles": [
      {
        "positionId": 54,
        "description": "חבר כנסת",
        "factionName": "יהדות התורה",
        "isCurrent": false,
        "startDate": null
      }
    ],
    "activity": [],
    "recentVotes": [],
    "votingSummary": null,
    "sourceUrl": "https://main.knesset.gov.il/mk/Apps/mk/mk-positions/1117",
    "hasNewData": false,
    "lastPolledAt": null
  }
]
```

- [ ] **Step 5.2: Verify the server reads it cleanly**

```bash
curl -s http://localhost:3001/api/parliament/mk | python3 -c "
import sys, json
mks = json.load(sys.stdin)
for mk in mks:
    print(mk['name'], '| activity:', len(mk.get('activity', [])), 'items')
"
```

Expected: both MKs listed with `activity: 0 items` (poller hasn't run yet).

- [ ] **Step 5.3: Trigger a manual refresh to populate activity**

```bash
curl -s -X GET "http://localhost:3001/api/parliament/mk" > /dev/null
# Wait for poller or trigger manually via the ↻ button in the drawer
# Or hit the refresh endpoint:
curl -s http://localhost:3001/api/health
```

Then check the drawer in the browser — the ↻ button calls `/api/parliament/mk` which returns current data. The poller runs automatically on server start and fills activity on the next cycle.

- [ ] **Step 5.4: Commit**

```bash
git add src/data/mks.json
git commit -m "fix: remove hand-crafted activity from mks.json; activity now filled by scraper"
```

---

### Task 6: Update `MkCard` — add question icon

**Files:**
- Modify: `src/components/parliament/MkCard.tsx`

- [ ] **Step 6.1: Add question icon to ACTIVITY_ICONS**

Find the `ACTIVITY_ICONS` constant and add the question entry:

```ts
const ACTIVITY_ICONS: Record<string, string> = {
  bill_initiated: '📋',
  vote: '🗳',
  duty_change: '🔄',
  question: '❓',
}
```

- [ ] **Step 6.2: Run tests**

```bash
npm test 2>&1 | grep -E "Test Files|Tests|passed|failed"
```

Expected: all tests still pass.

- [ ] **Step 6.3: Verify in browser**

Open the site at `http://localhost:5173`, click "מעקב כנסת", open the ח"כים tab. After the poller runs (or after clicking ↻ Refresh), the MK cards should show:
- `📋` for bills
- `❓` for parliamentary questions
- Items sorted newest date first (2026 before 2024 before 2023)

- [ ] **Step 6.4: Commit**

```bash
git add src/components/parliament/MkCard.tsx
git commit -m "fix: add question icon to MkCard activity feed"
```

---

## Run All Tests

```bash
npm test
```

Expected:
```
Test Files  7 passed (7)
Tests       31 passed (31)
```

## End-to-End Verification

1. Start both servers: `npm run dev`
2. Open `http://localhost:5173`
3. Click "מעקב כנסת" → open ח"כים tab
4. Both MKs show with photo, party, empty activity (before first poll)
5. Click ↻ רענן — activity populates from live Knesset API
6. Dan Ilouz shows 2026 bills (not 2022), Moshe Rot shows his bills and questions
7. Items sorted newest first
8. POST `/api/tracking/add` with a new MK URL → activity immediately populated on response
