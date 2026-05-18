# MK Combobox & Liberals Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable combobox to the Parliament Drawer that lists all ~120 Knesset 25 MKs and shows the selected MK's live activity card; also add a main-page Liberals Showcase section that auto-loads activity for annotated MKs.

**Architecture:** A new backend route `GET /api/mks/list` fetches all Knesset 25 members from the OData API (paginated), merges local liberal/supporter annotations from `MkAnnotationsRepository`, and caches the result in `MkListRepository` (file-backed, refreshed every 24h). Frontend hooks `useMkList` and `useMkActivity` provide session-cached data to `MkCombobox`, `MkActivityCard`, and `LiberalsShowcase` components.

**Tech Stack:** Express, Knesset OData API, React 18, Vitest, Testing Library, react-i18next

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add `KnessetMember` interface |
| `src/data/mk-annotations.json` | Create | Manually-managed liberal/supporter flags keyed by siteId |
| `src/data/knesset-members-cache.json` | Create (gitignored) | Auto-generated daily cache written by `MkListRepository` |
| `.gitignore` | Modify | Ignore `knesset-members-cache.json` |
| `server/repositories/mk-list-repository.ts` | Create | File-backed cache for full MK list |
| `server/repositories/mk-annotations-repository.ts` | Create | File-backed liberal/supporter annotations |
| `server/services/knesset-members.ts` | Create | Paginates OData to fetch all Knesset 25 MKs |
| `server/routes/mks.ts` | Create | `GET /api/mks/list` and `GET /api/mks/activity` |
| `server/index.ts` | Modify | Register `/api/mks` router |
| `src/lib/api-client.ts` | Modify | Add `api.mks.list()` and `api.mks.activity()` |
| `src/hooks/useMkList.ts` | Create | Session-cached fetch of MK list |
| `src/hooks/useMkActivity.ts` | Create | Per-siteId fetch with `Map` cache |
| `src/components/parliament/MkCombobox.tsx` | Create | Search input + dropdown with badges |
| `src/components/parliament/MkActivityCard.tsx` | Create | MkCard wrapper with spinner |
| `src/components/sections/LiberalsShowcase.tsx` | Create | Grid of annotated MKs, hidden when empty |
| `src/components/layout/ParliamentDrawer.tsx` | Modify | Swap MKs tab to combobox + card |
| `src/components/parliament/AddTrackingInput.tsx` | Modify | Remove MK option from TYPE_OPTIONS |
| `src/App.tsx` | Modify | Add `LiberalsShowcase` between About and Gallery |
| `src/locales/he.json` + `src/locales/en.json` | Modify | Add `showcase.*` i18n keys |
| `tests/server/mk-list-repository.test.ts` | Create | Repository unit tests |
| `tests/server/mk-annotations-repository.test.ts` | Create | Repository unit tests |
| `tests/server/knesset-members.test.ts` | Create | OData fetcher tests (mocked fetch) |
| `tests/server/mks-route.test.ts` | Create | Route integration tests |
| `tests/components/MkCombobox.test.tsx` | Create | Combobox behavior tests |
| `tests/components/MkActivityCard.test.tsx` | Create | Loading/loaded states |
| `tests/components/LiberalsShowcase.test.tsx` | Create | Hidden/visible tests |

---

## Task 1: Add `KnessetMember` Type, Data Files, and .gitignore

**Files:**
- Modify: `src/types.ts`
- Create: `src/data/mk-annotations.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add `KnessetMember` to `src/types.ts`**

After the last `export interface` in `src/types.ts`, append:

```typescript
export interface KnessetMember {
  siteId: number
  name: string
  party: string
  photoUrl: string | null
  isLiberal: boolean
  isSupporter: boolean
}
```

- [ ] **Step 2: Create `src/data/mk-annotations.json`**

```json
{
  "1116": { "isLiberal": true, "isSupporter": false },
  "1117": { "isLiberal": true, "isSupporter": false }
}
```

- [ ] **Step 3: Add cache file to `.gitignore`**

Open `.gitignore` and add on a new line:

```
src/data/knesset-members-cache.json
```

- [ ] **Step 4: Run full test suite to confirm no breakage**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/data/mk-annotations.json .gitignore
git commit -m "feat: add KnessetMember type and mk-annotations seed data"
```

---

## Task 2: `MkListRepository`

**Files:**
- Create: `server/repositories/mk-list-repository.ts`
- Create: `tests/server/mk-list-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/mk-list-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')

import { MkListRepository } from '../../server/repositories/mk-list-repository'

const MEMBER = { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false }

describe('MkListRepository', () => {
  let repo: MkListRepository

  beforeEach(() => {
    repo = new MkListRepository()
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(writeFile).mockResolvedValue()
  })

  afterEach(() => vi.clearAllMocks())

  it('get() returns null when cache file is absent', async () => {
    expect(await repo.get()).toBeNull()
  })

  it('get() returns members when cache file exists', async () => {
    const payload = JSON.stringify({ cachedAt: new Date().toISOString(), members: [MEMBER] })
    vi.mocked(readFile).mockResolvedValue(payload as never)
    const result = await repo.get()
    expect(result).toHaveLength(1)
    expect(result![0].siteId).toBe(1116)
  })

  it('set() writes JSON with cachedAt timestamp', async () => {
    await repo.set([MEMBER])
    expect(writeFile).toHaveBeenCalledOnce()
    const [, content] = vi.mocked(writeFile).mock.calls[0]
    const parsed = JSON.parse(content as string)
    expect(parsed.members).toHaveLength(1)
    expect(parsed.cachedAt).toBeTruthy()
  })

  it('getAgeMs() returns Infinity before any get/set', () => {
    expect(repo.getAgeMs()).toBe(Infinity)
  })

  it('getAgeMs() returns approximate elapsed time after set()', async () => {
    await repo.set([MEMBER])
    expect(repo.getAgeMs()).toBeGreaterThanOrEqual(0)
    expect(repo.getAgeMs()).toBeLessThan(1000)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- mk-list-repository
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/repositories/mk-list-repository.ts`**

```typescript
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { KnessetMember } from '../../src/types'

interface CacheFile {
  cachedAt: string
  members: KnessetMember[]
}

const CACHE_PATH = path.join(process.cwd(), 'src/data/knesset-members-cache.json')

export class MkListRepository {
  private cachedAt = 0

  async get(): Promise<KnessetMember[] | null> {
    try {
      const raw = await readFile(CACHE_PATH, 'utf-8')
      const data = JSON.parse(raw as string) as CacheFile
      this.cachedAt = new Date(data.cachedAt).getTime()
      return data.members
    } catch {
      return null
    }
  }

  async set(members: KnessetMember[]): Promise<void> {
    const cachedAt = new Date().toISOString()
    this.cachedAt = Date.now()
    await writeFile(CACHE_PATH, JSON.stringify({ cachedAt, members }, null, 2), 'utf-8')
  }

  getAgeMs(): number {
    return this.cachedAt ? Date.now() - this.cachedAt : Infinity
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- mk-list-repository
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/repositories/mk-list-repository.ts tests/server/mk-list-repository.test.ts
git commit -m "feat: add MkListRepository (file-backed cache)"
```

---

## Task 3: `MkAnnotationsRepository`

**Files:**
- Create: `server/repositories/mk-annotations-repository.ts`
- Create: `tests/server/mk-annotations-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/mk-annotations-repository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')

import { MkAnnotationsRepository } from '../../server/repositories/mk-annotations-repository'

describe('MkAnnotationsRepository', () => {
  let repo: MkAnnotationsRepository

  beforeEach(() => {
    repo = new MkAnnotationsRepository()
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(writeFile).mockResolvedValue()
  })

  afterEach(() => vi.clearAllMocks())

  it('getAll() returns empty object when file is absent', async () => {
    expect(await repo.getAll()).toEqual({})
  })

  it('getAll() returns parsed annotations', async () => {
    const payload = JSON.stringify({ '1116': { isLiberal: true, isSupporter: false } })
    vi.mocked(readFile).mockResolvedValue(payload as never)
    const result = await repo.getAll()
    expect(result['1116'].isLiberal).toBe(true)
  })

  it('set() merges new annotation with existing', async () => {
    const existing = JSON.stringify({ '1116': { isLiberal: true, isSupporter: false } })
    vi.mocked(readFile).mockResolvedValue(existing as never)
    await repo.set('1117', { isLiberal: false, isSupporter: true })
    const [, content] = vi.mocked(writeFile).mock.calls[0]
    const parsed = JSON.parse(content as string)
    expect(parsed['1116']).toBeTruthy()
    expect(parsed['1117'].isSupporter).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- mk-annotations-repository
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/repositories/mk-annotations-repository.ts`**

```typescript
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

interface Annotation {
  isLiberal: boolean
  isSupporter: boolean
}

const PATH = path.join(process.cwd(), 'src/data/mk-annotations.json')

export class MkAnnotationsRepository {
  async getAll(): Promise<Record<string, Annotation>> {
    try {
      const raw = await readFile(PATH, 'utf-8')
      return JSON.parse(raw as string) as Record<string, Annotation>
    } catch {
      return {}
    }
  }

  async set(siteId: string, annotation: Annotation): Promise<void> {
    const all = await this.getAll()
    all[siteId] = annotation
    await writeFile(PATH, JSON.stringify(all, null, 2), 'utf-8')
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- mk-annotations-repository
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/repositories/mk-annotations-repository.ts tests/server/mk-annotations-repository.test.ts
git commit -m "feat: add MkAnnotationsRepository (file-backed liberal/supporter flags)"
```

---

## Task 4: `fetchAllKnessetMembers` Service

**Files:**
- Create: `server/services/knesset-members.ts`
- Create: `tests/server/knesset-members.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/knesset-members.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { fetchAllKnessetMembers } from '../../server/services/knesset-members'

const SITE_CODES = [
  { SiteId: 1116, KnsID: 30839, KnessetNum: 25 },
  { SiteId: 1117, KnsID: 30870, KnessetNum: 25 },
]
const PERSONS = [
  { PersonID: 30839, FirstName: 'דן', LastName: 'אילוז', PictureDeputyUrl: null },
  { PersonID: 30870, FirstName: 'משה', LastName: 'רוט', PictureDeputyUrl: null },
]
const FACTIONS = [{ FactionID: 10, Name: 'הליכוד', KnessetNum: 25 }]
const POSITIONS = [
  { PersonID: 30839, FactionID: 10, IsCurrent: true },
  { PersonID: 30870, FactionID: 10, IsCurrent: true },
]

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

describe('fetchAllKnessetMembers', () => {
  beforeEach(() => vi.mocked(fetch).mockReset())

  it('returns empty array when site codes list is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([]))
    expect(await fetchAllKnessetMembers(25)).toEqual([])
  })

  it('assembles KnessetMember[] with name, siteId, and party', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(SITE_CODES))  // site codes page 1 (< PAGE_SIZE → done)
      .mockResolvedValueOnce(mockOdata(PERSONS))      // persons batch
      .mockResolvedValueOnce(mockOdata(FACTIONS))     // factions
      .mockResolvedValueOnce(mockOdata(POSITIONS))    // positions batch

    const result = await fetchAllKnessetMembers(25)

    expect(result).toHaveLength(2)
    expect(result[0].siteId).toBe(1116)
    expect(result[0].name).toBe('דן אילוז')
    expect(result[0].party).toBe('הליכוד')
    expect(result[0].isLiberal).toBe(false)
    expect(result[0].isSupporter).toBe(false)
  })

  it('paginates when first page returns full page size', async () => {
    // Simulate PAGE_SIZE = 50: first page full, second page empty
    const page1 = Array.from({ length: 50 }, (_, i) => ({ SiteId: i + 1, KnsID: i + 1, KnessetNum: 25 }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(page1))    // page 1 — full, triggers next
      .mockResolvedValueOnce(mockOdata([]))        // page 2 — empty, stops
      .mockResolvedValueOnce(mockOdata([]))        // persons batch
      .mockResolvedValueOnce(mockOdata([]))        // factions
      .mockResolvedValueOnce(mockOdata([]))        // positions batch (may be split)

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(50)
    // Verify that fetch was called twice for site codes (pagination)
    const siteCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      (url as string).includes('KNS_MkSiteCode')
    )
    expect(siteCalls).toHaveLength(2)
  })

  it('derives photo URL from siteId when PictureDeputyUrl is null', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([SITE_CODES[0]]))
      .mockResolvedValueOnce(mockOdata([PERSONS[0]]))
      .mockResolvedValueOnce(mockOdata(FACTIONS))
      .mockResolvedValueOnce(mockOdata([POSITIONS[0]]))

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].photoUrl).toBe('https://www.knesset.gov.il/mk/images/members/mk_1116.jpg')
  })

  it('uses PictureDeputyUrl when present', async () => {
    const personWithPhoto = { ...PERSONS[0], PictureDeputyUrl: '/mk/images/members/mk_1116.jpg' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([SITE_CODES[0]]))
      .mockResolvedValueOnce(mockOdata([personWithPhoto]))
      .mockResolvedValueOnce(mockOdata(FACTIONS))
      .mockResolvedValueOnce(mockOdata([POSITIONS[0]]))

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].photoUrl).toBe('https://www.knesset.gov.il/mk/images/members/mk_1116.jpg')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- knesset-members.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/services/knesset-members.ts`**

```typescript
import type { KnessetMember } from '../../src/types'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const PAGE_SIZE = 50
const BATCH_SIZE = 40

interface SiteCodeRow { SiteId: number; KnsID: number; KnessetNum: number }
interface PersonRow { PersonID: number; FirstName: string; LastName: string; PictureDeputyUrl?: string | null }
interface PositionRow { PersonID: number; FactionID: number | null; IsCurrent: boolean }
interface FactionRow { FactionID: number; Name: string; KnessetNum: number }

async function odataFetch<T>(path: string): Promise<T[]> {
  const res = await fetch(`${ODATA_BASE}/${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OData error ${res.status}: ${path}`)
  const data = await res.json() as { value?: T[] }
  return data.value ?? []
}

export async function fetchAllKnessetMembers(knessetNum: number): Promise<KnessetMember[]> {
  // Step 1: paginate KNS_MkSiteCode for all site codes in this knesset
  const siteCodes: SiteCodeRow[] = []
  let skip = 0
  while (true) {
    const page = await odataFetch<SiteCodeRow>(
      `KNS_MkSiteCode?$filter=KnessetNum%20eq%20${knessetNum}&$top=${PAGE_SIZE}&$skip=${skip}&$format=json`
    )
    siteCodes.push(...page)
    if (page.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  if (!siteCodes.length) return []

  const knsIds = [...new Set(siteCodes.map((r) => r.KnsID))]

  // Step 2: batch-fetch all persons
  const persons: PersonRow[] = []
  for (let i = 0; i < knsIds.length; i += BATCH_SIZE) {
    const batch = knsIds.slice(i, i + BATCH_SIZE)
    const filter = batch.map((id) => `PersonID%20eq%20${id}`).join('%20or%20')
    const page = await odataFetch<PersonRow>(
      `KNS_Person?$filter=${filter}&$top=${BATCH_SIZE}&$format=json`
    )
    persons.push(...page)
  }
  const personMap = new Map(persons.map((p) => [p.PersonID, p]))

  // Step 3: fetch all factions for this knesset
  const factions = await odataFetch<FactionRow>(
    `KNS_Faction?$filter=KnessetNum%20eq%20${knessetNum}&$format=json`
  )
  const factionMap = new Map(factions.map((f) => [f.FactionID, f.Name]))

  // Step 4: batch-fetch current positions to resolve party names
  const positions: PositionRow[] = []
  for (let i = 0; i < knsIds.length; i += BATCH_SIZE) {
    const batch = knsIds.slice(i, i + BATCH_SIZE)
    const filter = batch.map((id) => `PersonID%20eq%20${id}`).join('%20or%20')
    const page = await odataFetch<PositionRow>(
      `KNS_PersonToPosition?$filter=(${filter})%20and%20IsCurrent%20eq%20true%20and%20FactionID%20ne%20null&$top=100&$format=json`
    )
    positions.push(...page)
  }
  const personPartyMap = new Map<number, string>()
  for (const pos of positions) {
    if (!personPartyMap.has(pos.PersonID) && pos.FactionID != null) {
      personPartyMap.set(pos.PersonID, factionMap.get(pos.FactionID) ?? '')
    }
  }

  // Step 5: assemble
  return siteCodes.map((sc) => {
    const person = personMap.get(sc.KnsID)
    const name = person ? `${person.FirstName} ${person.LastName}`.trim() : `MK ${sc.SiteId}`
    const pictureUrl = person?.PictureDeputyUrl
    const photoUrl = pictureUrl
      ? `https://www.knesset.gov.il${pictureUrl}`
      : `https://www.knesset.gov.il/mk/images/members/mk_${sc.SiteId}.jpg`
    return {
      siteId: sc.SiteId,
      name,
      party: personPartyMap.get(sc.KnsID) ?? '',
      photoUrl,
      isLiberal: false,
      isSupporter: false,
    }
  })
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- knesset-members.test
```

Expected: 5 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/knesset-members.ts tests/server/knesset-members.test.ts
git commit -m "feat: add fetchAllKnessetMembers with OData pagination"
```

---

## Task 5: `GET /api/mks/list` and `GET /api/mks/activity` Routes

**Files:**
- Create: `server/routes/mks.ts`
- Create: `tests/server/mks-route.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/mks-route.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../../server/services/knesset-members', () => ({
  fetchAllKnessetMembers: vi.fn().mockResolvedValue([
    { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false },
  ]),
}))
vi.mock('../../server/services/knesset-scraper', () => ({
  fetchMkActivity: vi.fn().mockResolvedValue([
    { type: 'vote', date: '2026-05-13T11:42:00', title: 'הצבעה', detail: 'הצביע בעד' },
  ]),
}))
vi.mock('../../server/repositories/mk-list-repository', () => ({
  MkListRepository: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getAgeMs: vi.fn().mockReturnValue(Infinity),
  })),
}))
vi.mock('../../server/repositories/mk-annotations-repository', () => ({
  MkAnnotationsRepository: vi.fn().mockImplementation(() => ({
    getAll: vi.fn().mockResolvedValue({ '1116': { isLiberal: true, isSupporter: false } }),
  })),
}))

import mksRouter from '../../server/routes/mks'

const app = express()
app.use(express.json())
app.use('/api/mks', mksRouter)

describe('GET /api/mks/list', () => {
  it('returns 200 with array of KnessetMember', async () => {
    const res = await request(app).get('/api/mks/list')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].siteId).toBe(1116)
  })

  it('merges isLiberal annotation from repository', async () => {
    const res = await request(app).get('/api/mks/list')
    expect(res.body[0].isLiberal).toBe(true)
  })
})

describe('GET /api/mks/activity', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).get('/api/mks/activity')
    expect(res.status).toBe(400)
  })

  it('returns 200 with activity array for valid siteId', async () => {
    const res = await request(app).get('/api/mks/activity?siteId=1116')
    expect(res.status).toBe(200)
    expect(res.body[0].type).toBe('vote')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- mks-route
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/routes/mks.ts`**

```typescript
import { Router } from 'express'
import { fetchAllKnessetMembers } from '../services/knesset-members'
import { fetchMkActivity } from '../services/knesset-scraper'
import { MkListRepository } from '../repositories/mk-list-repository'
import { MkAnnotationsRepository } from '../repositories/mk-annotations-repository'
import type { KnessetMember } from '../../src/types'

const router = Router()
const mkListRepo = new MkListRepository()
const annotationsRepo = new MkAnnotationsRepository()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

router.get('/list', async (_req, res) => {
  try {
    const cached = await mkListRepo.get()
    if (cached && mkListRepo.getAgeMs() < CACHE_TTL_MS) {
      return res.json(cached)
    }
    const members = await fetchAllKnessetMembers(25)
    const annotations = await annotationsRepo.getAll()
    const annotated: KnessetMember[] = members.map((m) => ({
      ...m,
      isLiberal: annotations[String(m.siteId)]?.isLiberal ?? false,
      isSupporter: annotations[String(m.siteId)]?.isSupporter ?? false,
    }))
    await mkListRepo.set(annotated)
    res.json(annotated)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.get('/activity', async (req, res) => {
  const siteId = parseInt(req.query.siteId as string, 10)
  if (!siteId || isNaN(siteId)) return res.status(400).json({ error: 'siteId required' })
  try {
    const activity = await fetchMkActivity(siteId, 10)
    res.json(activity)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
```

- [ ] **Step 4: Register the router in `server/index.ts`**

Add after the existing import lines at the top:

```typescript
import mksRouter from './routes/mks'
```

Add after `app.use('/api/parliament', parliamentRouter)`:

```typescript
app.use('/api/mks', mksRouter)
```

- [ ] **Step 5: Run tests**

```bash
npm test -- mks-route
```

Expected: 4 tests PASS.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/mks.ts server/index.ts tests/server/mks-route.test.ts
git commit -m "feat: add GET /api/mks/list and /api/mks/activity routes"
```

---

## Task 6: i18n Keys + `api-client.ts` Additions

**Files:**
- Modify: `src/locales/he.json`
- Modify: `src/locales/en.json`
- Modify: `src/lib/api-client.ts`

- [ ] **Step 1: Add `showcase` keys to `src/locales/he.json`**

Add after the `"tracker"` section:

```json
"showcase": {
  "heading": "ח\"כים ליברלים בליכוד",
  "liberal_badge": "ליברל בליכוד",
  "supporter_badge": "תומך",
  "search_placeholder": "חפש ח\"כ...",
  "no_selection": "חפש ובחר ח\"כ למעלה"
}
```

- [ ] **Step 2: Add `showcase` keys to `src/locales/en.json`**

```json
"showcase": {
  "heading": "Liberals in Likud MKs",
  "liberal_badge": "Liberal",
  "supporter_badge": "Supporter",
  "search_placeholder": "Search MK...",
  "no_selection": "Search and select an MK above"
}
```

- [ ] **Step 3: Add MK endpoints to `src/lib/api-client.ts`**

Add `import type { KnessetMember, MkActivity } from '@/types'` to the existing type imports line, then add to the `api` export object:

```typescript
mks: {
  list: () => apiFetch<KnessetMember[]>('/mks/list'),
  activity: (siteId: number) => apiFetch<MkActivity[]>(`/mks/activity?siteId=${siteId}`),
},
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests PASS (mock returns Hebrew values for new keys automatically).

- [ ] **Step 5: Commit**

```bash
git add src/locales/he.json src/locales/en.json src/lib/api-client.ts
git commit -m "feat: add showcase i18n keys and mks api client methods"
```

---

## Task 7: `useMkList` Hook

**Files:**
- Create: `src/hooks/useMkList.ts`
- Create: `tests/unit/useMkList.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/useMkList.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({
  api: {
    mks: {
      list: vi.fn(),
    },
  },
}))

import { useMkList } from '@/hooks/useMkList'
import { api } from '@/lib/api-client'

const MEMBERS = [
  { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
]

describe('useMkList', () => {
  beforeEach(() => {
    vi.mocked(api.mks.list).mockResolvedValue(MEMBERS)
    // Reset module-level cache between tests
    vi.resetModules()
  })

  it('returns loading:true initially', () => {
    const { result } = renderHook(() => useMkList())
    expect(result.current.loading).toBe(true)
  })

  it('returns mks after fetch resolves', async () => {
    const { result } = renderHook(() => useMkList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.mks).toHaveLength(1)
    expect(result.current.mks[0].siteId).toBe(1116)
  })

  it('returns error when fetch fails', async () => {
    vi.mocked(api.mks.list).mockRejectedValueOnce(new Error('network error'))
    const { result } = renderHook(() => useMkList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network error')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- useMkList
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/hooks/useMkList.ts`**

```typescript
import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { KnessetMember } from '@/types'

let sessionCache: KnessetMember[] | null = null

export function useMkList() {
  const [mks, setMks] = useState<KnessetMember[]>(sessionCache ?? [])
  const [loading, setLoading] = useState(sessionCache === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionCache !== null) return
    api.mks.list()
      .then((data) => {
        sessionCache = data
        setMks(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return { mks, loading, error }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- useMkList
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMkList.ts tests/unit/useMkList.test.ts
git commit -m "feat: add useMkList hook with session cache"
```

---

## Task 8: `useMkActivity` Hook

**Files:**
- Create: `src/hooks/useMkActivity.ts`
- Create: `tests/unit/useMkActivity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/useMkActivity.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({
  api: {
    mks: {
      activity: vi.fn(),
    },
  },
}))

import { useMkActivity } from '@/hooks/useMkActivity'
import { api } from '@/lib/api-client'

const ACTIVITY = [{ type: 'vote' as const, date: '2026-05-13T11:42:00', title: 'הצבעה', detail: 'הצביע בעד' }]

describe('useMkActivity', () => {
  beforeEach(() => {
    vi.mocked(api.mks.activity).mockResolvedValue(ACTIVITY)
    vi.resetModules()
  })

  it('does not fetch when siteId is null', () => {
    renderHook(() => useMkActivity(null))
    expect(api.mks.activity).not.toHaveBeenCalled()
  })

  it('returns loading:true when siteId provided and not cached', () => {
    const { result } = renderHook(() => useMkActivity(1116))
    expect(result.current.loading).toBe(true)
  })

  it('returns activity after fetch resolves', async () => {
    const { result } = renderHook(() => useMkActivity(1116))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.activity).toHaveLength(1)
    expect(result.current.activity![0].type).toBe('vote')
  })

  it('fetches only once when siteId is the same across two renders', async () => {
    const { result, rerender } = renderHook(({ id }) => useMkActivity(id), {
      initialProps: { id: 1116 as number | null },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ id: 1116 })
    expect(api.mks.activity).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- useMkActivity
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/hooks/useMkActivity.ts`**

```typescript
import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import type { MkActivity } from '@/types'

const activityCache = new Map<number, MkActivity[]>()

export function useMkActivity(siteId: number | null) {
  const [activity, setActivity] = useState<MkActivity[] | null>(
    siteId !== null ? (activityCache.get(siteId) ?? null) : null
  )
  const [loading, setLoading] = useState(siteId !== null && !activityCache.has(siteId))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (siteId === null) return
    if (activityCache.has(siteId)) {
      setActivity(activityCache.get(siteId)!)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    api.mks.activity(siteId)
      .then((data) => {
        activityCache.set(siteId, data)
        setActivity(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [siteId])

  return { activity, loading, error }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- useMkActivity
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useMkActivity.ts tests/unit/useMkActivity.test.ts
git commit -m "feat: add useMkActivity hook with Map-based session cache"
```

---

## Task 9: `MkCombobox` Component

**Files:**
- Create: `src/components/parliament/MkCombobox.tsx`
- Create: `tests/components/MkCombobox.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/MkCombobox.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/hooks/useMkList', () => ({
  useMkList: () => ({
    mks: [
      { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
      { siteId: 999, name: 'יריב לוין', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false },
      { siteId: 888, name: 'בועז ביסמוט', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: true },
    ],
    loading: false,
    error: null,
  }),
}))

import MkCombobox from '@/components/parliament/MkCombobox'
import type { KnessetMember } from '@/types'

describe('MkCombobox', () => {
  it('renders the search placeholder when nothing is selected', () => {
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    expect(screen.getByText('חפש ח"כ...')).toBeInTheDocument()
  })

  it('opens dropdown and shows all MKs when clicked', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    expect(screen.getByText('דן אילוז')).toBeInTheDocument()
    expect(screen.getByText('יריב לוין')).toBeInTheDocument()
  })

  it('filters results by name when typing', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    await user.type(screen.getByPlaceholderText('חפש ח"כ...'), 'יריב')
    expect(screen.getByText('יריב לוין')).toBeInTheDocument()
    expect(screen.queryByText('דן אילוז')).not.toBeInTheDocument()
  })

  it('calls onSelect with the member when an item is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<MkCombobox onSelect={onSelect} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    await user.click(screen.getByText('דן אילוז'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 1116 }) as KnessetMember
    )
  })

  it('shows liberal badge for isLiberal MK', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    expect(screen.getByText(/ליברל/i)).toBeInTheDocument()
  })

  it('shows supporter badge for isSupporter MK', async () => {
    const user = userEvent.setup()
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={null} />)
    await user.click(screen.getByText('חפש ח"כ...'))
    expect(screen.getByText(/תומך/i)).toBeInTheDocument()
  })

  it('shows selected MK name when selectedSiteId is set', () => {
    render(<MkCombobox onSelect={vi.fn()} selectedSiteId={1116} />)
    expect(screen.getByText('דן אילוז')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- MkCombobox.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/parliament/MkCombobox.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMkList } from '@/hooks/useMkList'
import type { KnessetMember } from '@/types'

interface MkComboboxProps {
  onSelect: (member: KnessetMember) => void
  selectedSiteId: number | null
}

export default function MkCombobox({ onSelect, selectedSiteId }: MkComboboxProps) {
  const { t } = useTranslation()
  const { mks, loading } = useMkList()
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

  const selected = mks.find((m) => m.siteId === selectedSiteId)

  const filtered = mks
    .filter((mk) => {
      const q = query.toLowerCase()
      return !q || mk.name.toLowerCase().includes(q) || mk.party.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const score = (m: KnessetMember) => (m.isLiberal ? 2 : m.isSupporter ? 1 : 0)
      const diff = score(b) - score(a)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'he')
    })

  return (
    <div ref={containerRef} className="relative" dir="rtl">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-blue-50 px-3 py-2 text-start"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex-1 text-sm">
          {selected ? selected.name : <span className="text-muted-foreground">{t('showcase.search_placeholder')}</span>}
        </span>
        <span className="text-xs text-muted-foreground">▼</span>
      </button>

      {open && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-white shadow-lg">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              className="w-full text-sm outline-none"
              placeholder={t('showcase.search_placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              dir="rtl"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="p-4 text-center text-sm text-muted-foreground">...</div>
            )}
            {filtered.map((mk) => (
              <button
                key={mk.siteId}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-slate-50 ${
                  mk.siteId === selectedSiteId ? 'bg-blue-50' : ''
                }`}
                onClick={() => { onSelect(mk); setOpen(false); setQuery('') }}
              >
                {mk.photoUrl && (
                  <img
                    src={mk.photoUrl}
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                    alt=""
                  />
                )}
                <span className="flex-1 text-sm">{mk.name}</span>
                {mk.isLiberal && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    💙 {t('showcase.liberal_badge')}
                  </span>
                )}
                {mk.isSupporter && !mk.isLiberal && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    ⭐ {t('showcase.supporter_badge')}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{mk.party}</span>
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

- [ ] **Step 4: Run tests**

```bash
npm test -- MkCombobox.test
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/parliament/MkCombobox.tsx tests/components/MkCombobox.test.tsx
git commit -m "feat: add MkCombobox with fuzzy search and liberal/supporter badges"
```

---

## Task 10: `MkActivityCard` Component

**Files:**
- Create: `src/components/parliament/MkActivityCard.tsx`
- Create: `tests/components/MkActivityCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/MkActivityCard.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

const mockUseMkActivity = vi.fn()
vi.mock('@/hooks/useMkActivity', () => ({ useMkActivity: mockUseMkActivity }))

import MkActivityCard from '@/components/parliament/MkActivityCard'
import type { KnessetMember } from '@/types'

const MEMBER: KnessetMember = {
  siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null,
  isLiberal: true, isSupporter: false,
}

describe('MkActivityCard', () => {
  it('shows spinner while loading', () => {
    mockUseMkActivity.mockReturnValue({ activity: null, loading: true, error: null })
    render(<MkActivityCard member={MEMBER} />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows MK name when loaded', () => {
    mockUseMkActivity.mockReturnValue({ activity: [], loading: false, error: null })
    render(<MkActivityCard member={MEMBER} />)
    expect(screen.getByText('דן אילוז')).toBeInTheDocument()
  })

  it('shows error message when fetch failed', () => {
    mockUseMkActivity.mockReturnValue({ activity: null, loading: false, error: 'Network error' })
    render(<MkActivityCard member={MEMBER} />)
    expect(screen.getByText(/Network error/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- MkActivityCard.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/parliament/MkActivityCard.tsx`**

```typescript
import { useMkActivity } from '@/hooks/useMkActivity'
import MkCard from '@/components/parliament/MkCard'
import type { KnessetMember } from '@/types'
import type { Mk } from '@/types'

interface MkActivityCardProps {
  member: KnessetMember
}

export default function MkActivityCard({ member }: MkActivityCardProps) {
  const { activity, loading, error } = useMkActivity(member.siteId)

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        {error}
      </div>
    )
  }

  const mk: Mk = {
    id: member.siteId,
    oknesset_id: '',
    knesset_site_id: String(member.siteId),
    name: member.name,
    party: member.party,
    photoUrl: member.photoUrl,
    recentVotes: [],
    activity: activity ?? [],
    votingSummary: null,
    sourceUrl: `https://main.knesset.gov.il/mk/Apps/mk/mk-positions/${member.siteId}`,
    hasNewData: false,
    lastPolledAt: null,
  }

  return (
    <div className="relative">
      <MkCard mk={mk} />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- MkActivityCard.test
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/parliament/MkActivityCard.tsx tests/components/MkActivityCard.test.tsx
git commit -m "feat: add MkActivityCard with loading spinner"
```

---

## Task 11: `LiberalsShowcase` Section

**Files:**
- Create: `src/components/sections/LiberalsShowcase.tsx`
- Create: `tests/components/LiberalsShowcase.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/LiberalsShowcase.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'

const mockUseMkList = vi.fn()
vi.mock('@/hooks/useMkList', () => ({ useMkList: mockUseMkList }))
vi.mock('@/components/parliament/MkActivityCard', () => ({
  default: ({ member }: { member: { name: string } }) => <div data-testid="mk-card">{member.name}</div>,
}))

import LiberalsShowcase from '@/components/sections/LiberalsShowcase'

describe('LiberalsShowcase', () => {
  it('returns null when no annotated MKs', () => {
    mockUseMkList.mockReturnValue({
      mks: [{ siteId: 999, name: 'יריב לוין', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false }],
      loading: false, error: null,
    })
    const { container } = render(<LiberalsShowcase />)
    expect(container.firstChild).toBeNull()
  })

  it('renders MkActivityCard for each liberal MK', () => {
    mockUseMkList.mockReturnValue({
      mks: [
        { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
        { siteId: 1117, name: 'משה רוט', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
        { siteId: 999, name: 'יריב לוין', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false },
      ],
      loading: false, error: null,
    })
    render(<LiberalsShowcase />)
    expect(screen.getAllByTestId('mk-card')).toHaveLength(2)
  })

  it('renders supporter MKs alongside liberal MKs', () => {
    mockUseMkList.mockReturnValue({
      mks: [
        { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
        { siteId: 888, name: 'בועז ביסמוט', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: true },
      ],
      loading: false, error: null,
    })
    render(<LiberalsShowcase />)
    expect(screen.getAllByTestId('mk-card')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- LiberalsShowcase.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/sections/LiberalsShowcase.tsx`**

```typescript
import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import { useMkList } from '@/hooks/useMkList'
import MkActivityCard from '@/components/parliament/MkActivityCard'

export default function LiberalsShowcase() {
  const { t } = useTranslation()
  const direction = useDirection()
  const { mks } = useMkList()

  const annotated = mks.filter((m) => m.isLiberal || m.isSupporter)
  if (!annotated.length) return null

  return (
    <section id="liberals" className="bg-slate-50 py-16" dir={direction}>
      <div className="container mx-auto max-w-4xl px-4">
        <h2 className="mb-8 text-start text-2xl font-bold text-foreground">
          {t('showcase.heading')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {annotated.map((mk) => (
            <MkActivityCard key={mk.siteId} member={mk} />
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- LiberalsShowcase.test
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/LiberalsShowcase.tsx tests/components/LiberalsShowcase.test.tsx
git commit -m "feat: add LiberalsShowcase section, hidden when no annotated MKs"
```

---

## Task 12: Update `ParliamentDrawer` — MKs Tab

**Files:**
- Modify: `src/components/layout/ParliamentDrawer.tsx`

- [ ] **Step 1: Read current `src/components/layout/ParliamentDrawer.tsx`**

The MKs tab currently renders `{mks.map((mk) => <MkCard ... />)}`. Replace it with `MkCombobox` + `MkActivityCard`.

- [ ] **Step 2: Update the file**

Add these imports after the existing ones:

```typescript
import MkCombobox from '@/components/parliament/MkCombobox'
import MkActivityCard from '@/components/parliament/MkActivityCard'
import type { KnessetMember } from '@/types'
```

Add `selectedMk` state inside the component (after the existing `lastSyncedLabel` line):

```typescript
const [selectedMk, setSelectedMk] = useState<KnessetMember | null>(null)
```

Add `useState` to the React import at the top if not already imported: `import { useState } from 'react'`

Replace the entire `<TabsContent value="mks" ...>` block with:

```typescript
<TabsContent value="mks" className="m-0 space-y-3 p-4">
  <MkCombobox onSelect={setSelectedMk} selectedSiteId={selectedMk?.siteId ?? null} />
  {selectedMk ? (
    <MkActivityCard member={selectedMk} />
  ) : (
    <p className="py-8 text-start text-sm text-muted-foreground">{t('showcase.no_selection')}</p>
  )}
</TabsContent>
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS (existing `ParliamentDrawer` tests still pass since the drawer itself still renders).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/ParliamentDrawer.tsx
git commit -m "feat: replace MKs tab stack with MkCombobox + MkActivityCard"
```

---

## Task 13: Update `AddTrackingInput` and `App.tsx`

**Files:**
- Modify: `src/components/parliament/AddTrackingInput.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Remove MK option from `AddTrackingInput`**

In `src/components/parliament/AddTrackingInput.tsx`, find the `TYPE_OPTIONS` array inside the component function and remove the MK entry:

```typescript
// Before
const TYPE_OPTIONS: { value: TrackingType; label: string }[] = [
  { value: 'bill', label: t('tracker.tab_bill') },
  { value: 'committee', label: t('tracker.tab_committee') },
  { value: 'mk', label: t('tracker.tab_mk') },
]

// After
const TYPE_OPTIONS: { value: TrackingType; label: string }[] = [
  { value: 'bill', label: t('tracker.tab_bill') },
  { value: 'committee', label: t('tracker.tab_committee') },
]
```

- [ ] **Step 2: Add `LiberalsShowcase` to `src/App.tsx`**

Add import after existing section imports:

```typescript
import LiberalsShowcase from '@/components/sections/LiberalsShowcase'
```

Place `<LiberalsShowcase />` in the JSX between `<AboutSection />` and `<GallerySection />`:

```typescript
<AboutSection />
<LiberalsShowcase />
<GallerySection />
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/parliament/AddTrackingInput.tsx src/App.tsx
git commit -m "feat: remove MK url-paste from AddTrackingInput, add LiberalsShowcase to App"
```

---

## Task 14: Final Verification + Merge

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests PASS (the plan adds ~30 new tests).

- [ ] **Step 2: Start dev server and manually verify**

```bash
npm run dev
```

Open **http://localhost:5173** and check:

1. Open Parliament Drawer → MKs tab → shows search combobox with prompt "חפש ובחר ח"כ למעלה"
2. Click combobox → dropdown opens with loading indicator, then 120 MKs appear
3. Type "יריב" → list filters to matching MKs
4. Select Dan Ilouz (1116) → combobox closes, his activity card loads with spinner, then activity appears
5. Select a different MK → their card loads (Ilouz card cached, loads instantly on re-select)
6. Main page → `LiberalsShowcase` section visible between "Who We Are" and Gallery (because mk-annotations.json has Ilouz and Rot as isLiberal: true)
7. Each liberal card shows spinner then activity
8. Bills/Committees tabs in drawer still work as before

- [ ] **Step 3: Merge to master**

```bash
git checkout master
git merge <worktree-branch-name> --no-edit
```
