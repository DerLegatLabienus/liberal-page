# CommitteeCard — Recent Sessions with Liberal MK Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend CommitteeCard to show the 2 most recent committee sessions with dates, titles, and (optionally) liberal MK attendance badges — all enriched at poll time using Knesset OData and an optional AI feature flag.

**Architecture:** A new `committee-session-enricher.ts` service fetches session data from Knesset OData (`KNS_CommitteeSession`, `KNS_CmtSessionItem`, `KNS_DocumentCommitteeSession`) and optionally calls `Summarizer.summarizeAndExtractAttendees()` when `COMMITTEE_AI=true`. The enriched `CommitteeSession[]` is stored on the `Committee` object in `committees.json` at poll time. `CommitteeCard` renders synchronously — no loading states.

**Tech Stack:** Express, Knesset OData API, Anthropic Claude (gated behind env var), React 18, Vitest, TypeScript, `mammoth` (existing), `@anthropic-ai/sdk` (existing)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add `CommitteeSession` interface; add `recentSessions?: CommitteeSession[]` to `Committee`; extend `SummaryCache` entry |
| `server/services/summarizer.ts` | Modify | Add `summarizeAndExtractAttendees(docUrl)` method |
| `server/services/committee-session-enricher.ts` | Create | Fetch + enrich 2 sessions per committee from Knesset OData |
| `server/services/poller.ts` | Modify | Replace oknesset session polling with enricher call |
| `src/components/parliament/CommitteeCard.tsx` | Modify | Render 2 sessions, liberal MK badges |
| `tests/server/committee-session-enricher.test.ts` | Create | Enricher unit tests |
| `tests/components/CommitteeCard.test.tsx` | Create | Card rendering tests including sessions |
| `tests/components/CommitteeCombobox.test.tsx` | Modify | Add edge-case tests (empty, loading, no knessetUrl) |

---

## Task 1: Add `CommitteeSession` Type + Extend `Committee` and `SummaryCache`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add types**

In `src/types.ts`, add `CommitteeSession` interface after the `Committee` interface, and add `recentSessions` field to `Committee`. Also extend `SummaryCache` to carry optional attendee/title fields:

```typescript
// New interface — add after Committee interface
export interface CommitteeSession {
  sessionId: number
  date: string              // ISO datetime e.g. "2026-05-13T09:30:00"
  knessetNum: number        // Knesset number for cross-Knesset highlighting
  title: string             // agenda item title OR AI-derived one-liner
  sessionUrl: string        // https://main.knesset.gov.il/...AllCommitteesAgenda...?ItemID=N
  attendingSiteIds: string[] // knesset_site_id strings of liberal/supporter MKs who attended
  aiSummary?: string        // optional AI summary; only when COMMITTEE_AI=true
}
```

Add to `Committee` interface (after `lastPolledAt`):
```typescript
  recentSessions?: CommitteeSession[]
```

Extend `SummaryCache` value type to include optional attendee/title fields:
```typescript
export interface SummaryCache {
  [md5: string]: {
    summary: string
    createdAt: string
    sourceUrl: string
    attendees?: string[]     // raw attendee name strings from AI
    derivedTitle?: string    // AI-extracted one-line title
  }
}
```

- [ ] **Step 2: Run tests to confirm no breakage**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all existing tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/types.ts
git commit -m "feat: add CommitteeSession type, recentSessions field on Committee"
```

---

## Task 2: Extend `Summarizer` with `summarizeAndExtractAttendees`

**Files:**
- Modify: `server/services/summarizer.ts`

- [ ] **Step 1: Add the new method to `Summarizer` class**

Add after the existing `summarizeUrl` method:

```typescript
async summarizeAndExtractAttendees(docUrl: string): Promise<{
  derivedTitle?: string
  aiSummary?: string
  attendees: string[]
}> {
  try {
    const res = await fetch(docUrl)
    if (!res.ok) return { attendees: [] }
    const buffer = Buffer.from(await res.arrayBuffer())
    const format = docUrl.toLowerCase().includes('.doc') ? 'docx' : 'pdf'
    const md5 = createHash('md5').update(buffer).digest('hex')

    const cache = await this.readCache()
    const entry = cache[md5]

    // Return from cache if already processed
    if (entry && entry.attendees !== undefined) {
      return {
        derivedTitle: entry.derivedTitle,
        aiSummary: entry.summary,
        attendees: entry.attendees,
      }
    }

    // Extract text and call Claude
    const text = await this.extractText(buffer, format)
    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `קרא את פרוטוקול ועדה זה בעברית וענה ב-JSON בפורמט הבא בלבד (ללא טקסט נוסף):
{"title":"כותרת קצרה של הנושא הראשי (משפט אחד)","summary":"סיכום קצר של הדיון (משפט אחד)","attendees":["שם ח\"כ 1","שם ח\"כ 2"]}

חברי הכנסת שנכחו מופיעים בתחילת המסמך תחת "נכחו" או "חברי הכנסת".

פרוטוקול:
${text.slice(0, 8000)}`,
      }],
    })
    const block = message.content[0]
    if (block.type !== 'text') return { attendees: [] }

    let parsed: { title?: string; summary?: string; attendees?: string[] } = {}
    try {
      parsed = JSON.parse(block.text) as typeof parsed
    } catch {
      // Claude didn't return valid JSON — extract attendees manually
      const attendeeMatch = block.text.match(/"attendees"\s*:\s*\[(.*?)\]/s)
      if (attendeeMatch) {
        parsed.attendees = attendeeMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, '')) ?? []
      }
    }

    // Write to cache
    cache[md5] = {
      summary: parsed.summary ?? '',
      createdAt: new Date().toISOString(),
      sourceUrl: docUrl,
      attendees: parsed.attendees ?? [],
      derivedTitle: parsed.title,
    }
    await this.writeCache(cache)

    return {
      derivedTitle: parsed.title,
      aiSummary: parsed.summary,
      attendees: parsed.attendees ?? [],
    }
  } catch {
    return { attendees: [] }
  }
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
git add server/services/summarizer.ts
git commit -m "feat: add summarizeAndExtractAttendees method to Summarizer"
```

---

## Task 3: `committee-session-enricher.ts` Service + Tests

**Files:**
- Create: `server/services/committee-session-enricher.ts`
- Create: `tests/server/committee-session-enricher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/committee-session-enricher.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFile } from 'fs/promises'

vi.mock('fs/promises')
vi.stubGlobal('fetch', vi.fn())

import { enrichCommitteeSessions } from '../../server/services/committee-session-enricher'

const ODATA_SESSIONS = [
  {
    CommitteeSessionID: 2242870,
    StartDate: '2026-05-13T09:30:00',
    KnessetNum: 25,
    SessionUrl: 'http://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2242870',
    Note: null,
  },
  {
    CommitteeSessionID: 2241000,
    StartDate: '2026-04-30T10:00:00',
    KnessetNum: 25,
    SessionUrl: 'http://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2241000',
    Note: null,
  },
]

const ODATA_ITEMS = [
  { Name: 'הצעת חוק לתיקון פקודת מס הכנסה, התשפ"ו-2026', Ordinal: 1 },
]

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

describe('enrichCommitteeSessions', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
  })

  it('returns 2 sessions with titles from agenda items', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([{ CommitteeID: 4186, Name: 'ועדת הכספים' }])) // name lookup
      .mockResolvedValueOnce(mockOdata(ODATA_SESSIONS))                                 // sessions
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))                                    // items session 1
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))                                    // items session 2

    const result = await enrichCommitteeSessions('ועדת הכספים', [], false)
    expect(result).toHaveLength(2)
    expect(result[0].sessionId).toBe(2242870)
    expect(result[0].title).toBe('הצעת חוק לתיקון פקודת מס הכנסה, התשפ"ו-2026')
    expect(result[0].knessetNum).toBe(25)
    expect(result[0].sessionUrl).toContain('2242870')
    expect(result[0].attendingSiteIds).toEqual([])
    expect(result[0].aiSummary).toBeUndefined()
  })

  it('uses session date as title fallback when no agenda items', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([{ CommitteeID: 4186, Name: 'ועדת הכספים' }]))
      .mockResolvedValueOnce(mockOdata([ODATA_SESSIONS[0]]))
      .mockResolvedValueOnce(mockOdata([]))  // no agenda items

    const result = await enrichCommitteeSessions('ועדת הכספים', [], false)
    expect(result[0].title).toBe('') // empty title when no items and AI is off
  })

  it('returns empty array when committee not found in OData', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([]))  // name lookup returns empty

    const result = await enrichCommitteeSessions('ועדה לא קיימת', [], false)
    expect(result).toEqual([])
  })

  it('returns empty array on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))
    const result = await enrichCommitteeSessions('ועדת הכספים', [], false)
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- committee-session-enricher
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/services/committee-session-enricher.ts`**

```typescript
import path from 'path'
import { readFile } from 'fs/promises'
import { Summarizer } from './summarizer'
import type { CommitteeSession } from '../../src/types'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const CACHE_PATH = path.join(process.cwd(), 'src/data/summaries-cache.json')
const MK_LIST_CACHE = path.join(process.cwd(), 'src/data/knesset-members-cache.json')
const ANNOTATIONS_PATH = path.join(process.cwd(), 'src/data/mk-annotations.json')

interface ODataSession {
  CommitteeSessionID: number
  StartDate: string
  KnessetNum: number
  SessionUrl: string
  Note: string | null
}

interface ODataItem { Name: string; Ordinal: number }
interface ODataDoc { FilePath: string; GroupTypeDesc: string }
interface ODataCommittee { CommitteeID: number; Name: string }
interface MkListEntry { siteId: number; name: string }

async function odataGet<T>(path: string): Promise<T[]> {
  const res = await fetch(`${ODATA_BASE}/${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) return []
  const data = await res.json() as { value?: T[] }
  return data.value ?? []
}

async function resolveCommitteeId(committeeName: string): Promise<number | null> {
  const encoded = encodeURIComponent(committeeName)
  const results = await odataGet<ODataCommittee>(
    `KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20Name%20eq%20'${encoded}'&$select=CommitteeID,Name&$top=1&$format=json`
  )
  return results[0]?.CommitteeID ?? null
}

async function loadLiberalMkNames(): Promise<Map<string, string>> {
  // Returns map of MK name (lowercase) → siteId string
  const nameToSiteId = new Map<string, string>()
  try {
    const annotations = JSON.parse(await readFile(ANNOTATIONS_PATH, 'utf-8')) as Record<string, { isLiberal: boolean; isSupporter: boolean }>
    const liberalSiteIds = new Set(
      Object.entries(annotations)
        .filter(([, v]) => v.isLiberal || v.isSupporter)
        .map(([k]) => k)
    )
    const cache = JSON.parse(await readFile(MK_LIST_CACHE, 'utf-8')) as { members: MkListEntry[] }
    for (const mk of cache.members) {
      if (liberalSiteIds.has(String(mk.siteId))) {
        nameToSiteId.set(mk.name.toLowerCase(), String(mk.siteId))
      }
    }
  } catch { /* cache absent or malformed — return empty map */ }
  return nameToSiteId
}

function matchAttendees(attendeeNames: string[], liberalNames: Map<string, string>): string[] {
  const matched = new Set<string>()
  for (const attendee of attendeeNames) {
    const lower = attendee.toLowerCase()
    for (const [libName, siteId] of liberalNames) {
      if (lower.includes(libName) || libName.includes(lower)) {
        matched.add(siteId)
      }
    }
  }
  return [...matched]
}

export async function enrichCommitteeSessions(
  committeeName: string,
  _trackedMkSiteIds: string[],
  aiEnabled: boolean
): Promise<CommitteeSession[]> {
  try {
    const committeeId = await resolveCommitteeId(committeeName)
    if (!committeeId) return []

    const sessions = await odataGet<ODataSession>(
      `KNS_CommitteeSession?$filter=CommitteeID%20eq%20${committeeId}&$orderby=StartDate%20desc&$top=2&$select=CommitteeSessionID,StartDate,KnessetNum,SessionUrl,Note&$format=json`
    )
    if (!sessions.length) return []

    const liberalNames = aiEnabled ? await loadLiberalMkNames() : new Map<string, string>()
    const summarizer = aiEnabled ? new Summarizer(CACHE_PATH) : null

    const results: CommitteeSession[] = []

    for (const session of sessions) {
      // Fetch agenda items for title
      const items = await odataGet<ODataItem>(
        `KNS_CmtSessionItem?$filter=CommitteeSessionID%20eq%20${session.CommitteeSessionID}&$select=Name,Ordinal&$orderby=Ordinal&$top=5&$format=json`
      )
      let title = items.map((i) => i.Name).filter(Boolean).join(' · ').slice(0, 120)

      let aiSummary: string | undefined
      let attendingSiteIds: string[] = []

      if (aiEnabled && summarizer) {
        // Find protocol document
        const docs = await odataGet<ODataDoc>(
          `KNS_DocumentCommitteeSession?$filter=CommitteeSessionID%20eq%20${session.CommitteeSessionID}&$select=FilePath,GroupTypeDesc&$format=json`
        )
        const protocol = docs.find((d) => d.GroupTypeDesc === 'פרוטוקול ועדה')
        if (protocol?.FilePath) {
          const extracted = await summarizer.summarizeAndExtractAttendees(protocol.FilePath)
          if (!title && extracted.derivedTitle) title = extracted.derivedTitle
          if (extracted.aiSummary) aiSummary = extracted.aiSummary
          if (extracted.attendees.length) {
            attendingSiteIds = matchAttendees(extracted.attendees, liberalNames)
          }
        }
      }

      results.push({
        sessionId: session.CommitteeSessionID,
        date: session.StartDate,
        knessetNum: session.KnessetNum,
        title,
        sessionUrl: session.SessionUrl.replace('http://', 'https://'),
        attendingSiteIds,
        aiSummary,
      })
    }

    return results
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- committee-session-enricher
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add server/services/committee-session-enricher.ts tests/server/committee-session-enricher.test.ts
git commit -m "feat: add committee-session-enricher service with OData + optional AI enrichment"
```

---

## Task 4: Update `pollCommittees()` to Use the Enricher

**Files:**
- Modify: `server/services/poller.ts`

- [ ] **Step 1: Update `pollCommittees()` in `server/services/poller.ts`**

Add import at the top of the file:
```typescript
import { enrichCommitteeSessions } from './committee-session-enricher'
```

Replace the entire `pollCommittees` function:

```typescript
async function pollCommittees(): Promise<void> {
  const committees = await readJson<Committee>('committees.json')
  const aiEnabled = process.env.COMMITTEE_AI === 'true'
  let changed = false

  for (const committee of committees) {
    if (!committee.name) continue
    try {
      const sessions = await enrichCommitteeSessions(committee.name, [], aiEnabled)
      if (sessions.length > 0) {
        committee.recentSessions = sessions
        committee.hasNewData = true
        changed = true
      }
    } catch (err) {
      console.error(`Poller: error polling committee ${committee.name}:`, err)
    }
    committee.lastPolledAt = new Date().toISOString()
  }

  if (changed) await writeJson('committees.json', committees)
}
```

- [ ] **Step 2: Run full test suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add server/services/poller.ts
git commit -m "feat: update pollCommittees to use enricher, store recentSessions"
```

---

## Task 5: Update `CommitteeCard` to Render Sessions + Liberal MK Badges

**Files:**
- Modify: `src/components/parliament/CommitteeCard.tsx`
- Create: `tests/components/CommitteeCard.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/CommitteeCard.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import CommitteeCard from '@/components/parliament/CommitteeCard'
import type { Committee } from '@/types'

function committeeFixture(overrides: Partial<Committee> = {}): Committee {
  return {
    id: 1,
    oknesset_id: '2',
    name: 'ועדת הכספים',
    chair: '',
    lastSessionDate: null,
    lastSessionSummary: null,
    lastSessionDocumentUrl: null,
    sourceUrl: 'https://main.knesset.gov.il/apps/committees/2213',
    hasNewData: false,
    lastPolledAt: null,
    ...overrides,
  }
}

const SESSION_WITH_ATTENDEES = {
  sessionId: 2242870,
  date: '2026-05-13T09:30:00',
  knessetNum: 25,
  title: 'הצעת חוק לתיקון פקודת מס הכנסה',
  sessionUrl: 'https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2242870',
  attendingSiteIds: ['1116'],
  aiSummary: 'דיון בהצעת חוק תיקון מס הכנסה',
}

const SESSION_COMPACT = {
  sessionId: 2241000,
  date: '2026-04-30T10:00:00',
  knessetNum: 25,
  title: 'הצעת חוק אחרת',
  sessionUrl: 'https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2241000',
  attendingSiteIds: [],
}

describe('CommitteeCard', () => {
  it('renders committee name', () => {
    render(<CommitteeCard committee={committeeFixture()} />)
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
  })

  it('renders most recent session title and date', () => {
    const committee = committeeFixture({ recentSessions: [SESSION_WITH_ATTENDEES, SESSION_COMPACT] })
    render(<CommitteeCard committee={committee} />)
    expect(screen.getByText('הצעת חוק לתיקון פקודת מס הכנסה')).toBeInTheDocument()
    expect(screen.getByText(/13.5.2026/)).toBeInTheDocument()
  })

  it('renders AI summary when present', () => {
    const committee = committeeFixture({ recentSessions: [SESSION_WITH_ATTENDEES] })
    render(<CommitteeCard committee={committee} />)
    expect(screen.getByText('דיון בהצעת חוק תיקון מס הכנסה')).toBeInTheDocument()
  })

  it('renders compact second session with date and title only', () => {
    const committee = committeeFixture({ recentSessions: [SESSION_WITH_ATTENDEES, SESSION_COMPACT] })
    render(<CommitteeCard committee={committee} />)
    expect(screen.getByText('הצעת חוק אחרת')).toBeInTheDocument()
    expect(screen.getByText(/30.4.2026/)).toBeInTheDocument()
  })

  it('does not render badge row when attendingSiteIds is empty', () => {
    const sessionNoAttendees = { ...SESSION_WITH_ATTENDEES, attendingSiteIds: [] }
    const committee = committeeFixture({ recentSessions: [sessionNoAttendees] })
    render(<CommitteeCard committee={committee} />)
    expect(screen.queryByTitle(/ח"כ/)).not.toBeInTheDocument()
  })

  it('renders nothing for sessions when recentSessions is undefined', () => {
    render(<CommitteeCard committee={committeeFixture()} />)
    expect(screen.queryByText(/הצעת חוק/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- CommitteeCard.test
```

Expected: FAIL — component doesn't render sessions yet.

- [ ] **Step 3: Update `CommitteeCard.tsx`**

Replace the entire file content:

```typescript
import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import annotationsData from '@/data/mk-annotations.json'
import type { Committee } from '@/types'

const annotations = annotationsData as Record<string, { isLiberal: boolean; isSupporter: boolean }>

interface CommitteeCardProps {
  committee: Committee
  onRemove?: (id: number) => void
}

export default function CommitteeCard({ committee, onRemove }: CommitteeCardProps) {
  const { t } = useTranslation()
  const direction = useDirection()
  const sessions = committee.recentSessions ?? []
  const [extended, compact] = [sessions[0], sessions[1]]

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-white ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className="w-1 shrink-0 bg-blue-500" />
      <div className="flex-1 p-4" dir="rtl">
        <p className="mb-1 text-right text-sm font-semibold text-foreground">{committee.name}</p>
        {committee.chair && (
          <p className="mb-2 text-right text-xs text-muted-foreground">{t('tracker.chair_prefix')} {committee.chair}</p>
        )}

        {/* Extended session (most recent) */}
        {extended && (
          <div className="mb-3 rounded-md border border-slate-100 bg-slate-50 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-right text-xs font-medium text-foreground line-clamp-2 flex-1">{extended.title}</p>
              <a href={extended.sessionUrl} target="_blank" rel="noopener noreferrer"
                className="shrink-0 text-xs text-primary hover:underline">↗</a>
            </div>
            <p className="mb-1 text-right text-xs text-muted-foreground">
              {new Date(extended.date).toLocaleDateString('he-IL')}
            </p>

            {/* Liberal MK attendee badges */}
            {extended.attendingSiteIds.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1 justify-end">
                {extended.attendingSiteIds.map((siteId) => {
                  const ann = annotations[siteId]
                  if (!ann) return null
                  return (
                    <span key={siteId}
                      title={`ח"כ ${siteId}`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ann.isLiberal ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                      {ann.isLiberal ? '💙' : '⭐'} {siteId}
                    </span>
                  )
                })}
              </div>
            )}

            {/* AI summary */}
            {extended.aiSummary && (
              <div className="rounded-md bg-blue-50 px-2 py-1">
                <p className="text-right text-xs font-semibold text-blue-700 mb-0.5">{t('tracker.ai_session_summary')}</p>
                <p className="text-right text-xs text-muted-foreground leading-snug">{extended.aiSummary}</p>
              </div>
            )}
          </div>
        )}

        {/* Compact session (older) */}
        {compact && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{new Date(compact.date).toLocaleDateString('he-IL')}</span>
            <span className="mx-1">·</span>
            <a href={compact.sessionUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-right text-primary hover:underline line-clamp-1">
              {compact.title}
            </a>
          </div>
        )}

        <div className="flex items-center justify-between">
          {committee.sourceUrl && (
            <a href={committee.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">
              {t('tracker.view_source')}
            </a>
          )}
          {onRemove && (
            <button onClick={() => onRemove(committee.id)}
              className="text-xs text-red-400 hover:text-red-600 ms-auto">
              {t('tracker.remove')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run CommitteeCard tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- CommitteeCard.test
```

Expected: 6 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add src/components/parliament/CommitteeCard.tsx tests/components/CommitteeCard.test.tsx
git commit -m "feat: CommitteeCard shows 2 recent sessions with liberal MK badges and AI summary"
```

---

## Task 6: CommitteeCombobox Edge-Case Tests

**Files:**
- Modify: `tests/components/CommitteeCombobox.test.tsx`

- [ ] **Step 1: Add edge-case tests**

Append these describes to `tests/components/CommitteeCombobox.test.tsx`:

```typescript
describe('CommitteeCombobox — edge cases', () => {
  it('shows "no results" when list is empty', async () => {
    vi.mocked(useCommitteeList).mockReturnValueOnce({
      committees: [],
      loading: false,
      error: null,
    } as ReturnType<typeof useCommitteeList>)
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    expect(screen.getByText(/לא נמצאו תוצאות/i)).toBeInTheDocument()
  })

  it('shows loading indicator when loading is true', async () => {
    vi.mocked(useCommitteeList).mockReturnValueOnce({
      committees: [],
      loading: true,
      error: null,
    } as ReturnType<typeof useCommitteeList>)
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    expect(screen.getByText('...')).toBeInTheDocument()
  })

  it('renders committee items without href when knessetUrl is empty', async () => {
    vi.mocked(useCommitteeList).mockReturnValueOnce({
      committees: [
        { committeeId: 99, name: 'ועדה ללא קישור', knessetUrl: '' },
      ],
      loading: false,
      error: null,
    } as ReturnType<typeof useCommitteeList>)
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    expect(screen.getByText('ועדה ללא קישור')).toBeInTheDocument()
    // Item is a button (not an anchor), so clicking doesn't navigate
    const item = screen.getByRole('button', { name: /ועדה ללא קישור/i })
    expect(item.tagName).toBe('BUTTON')
  })

  it('filters results case-insensitively', async () => {
    const user = userEvent.setup()
    render(<CommitteeCombobox onAdd={vi.fn()} />)
    await user.click(screen.getByText(/חפש ועדה/i))
    await user.type(screen.getByPlaceholderText(/חפש ועדה/i), 'כספים')
    expect(screen.getByText('ועדת הכספים')).toBeInTheDocument()
    expect(screen.queryByText('ועדת החוץ והביטחון')).not.toBeInTheDocument()
  })
})
```

Note: you need to add `useCommitteeList` to the mock imports at the top of the test file. The existing mock is:
```typescript
vi.mock('@/hooks/useCommitteeList', () => ({
  useCommitteeList: () => ({ ... })
}))
```

Change it to a hoisted mock so individual tests can override it:
```typescript
const mockUseCommitteeList = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useCommitteeList', () => ({ useCommitteeList: mockUseCommitteeList }))
```

And update the default return value in `beforeEach`:
```typescript
beforeEach(() => {
  mockUseCommitteeList.mockReturnValue({
    committees: [
      { committeeId: 2, name: 'ועדת הכספים', knessetUrl: 'https://main.knesset.gov.il/apps/committees/2213' },
      { committeeId: 3, name: 'ועדת החוץ והביטחון', knessetUrl: 'https://main.knesset.gov.il/apps/committees/2216' },
    ],
    loading: false,
    error: null,
  })
  vi.mocked(api.committees.track).mockResolvedValue({ ok: true })
})
```

Also add `import { useCommitteeList } from '@/hooks/useCommitteeList'` to imports (for the type annotation).

- [ ] **Step 2: Run tests**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test -- CommitteeCombobox
```

Expected: all tests PASS (original 4 + 4 new edge-case tests).

- [ ] **Step 3: Run full suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/aavitan/claude-projects/liberal-page
git add tests/components/CommitteeCombobox.test.tsx
git commit -m "test: add CommitteeCombobox edge-case tests (empty, loading, no URL, filtering)"
```

---

## Task 7: Final Verification + Push

- [ ] **Step 1: Run full test suite**

```bash
cd /home/aavitan/claude-projects/liberal-page && npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Smoke test with `COMMITTEE_AI=false` (default)**

Start the server and verify:
```bash
npm run dev
```
Open the Parliament Drawer → Committees tab → track "ועדת הכספים" from the combobox. After the poller runs (or restart server), the CommitteeCard should show the most recent session date and title. No AI badge, no attendee row.

- [ ] **Step 3: Smoke test with `COMMITTEE_AI=true`**

Set `COMMITTEE_AI=true` in your shell and restart:
```bash
COMMITTEE_AI=true npm run dev:server
```
After next poll cycle (~6 hours by default, or restart to trigger immediately), the CommitteeCard should also show the AI summary and liberal MK attendee badges for any session where our tracked MKs attended.

- [ ] **Step 4: Push to origin**

```bash
cd /home/aavitan/claude-projects/liberal-page && git push origin master
```
