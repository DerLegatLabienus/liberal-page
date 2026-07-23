import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFile } from 'fs/promises'

vi.stubGlobal('fetch', vi.fn())
vi.mock('fs/promises')
vi.mock('../../server/services/bill-status-map', () => ({
  getBillStatusMap: vi.fn(async () => new Map([[101, 'הכנה לקריאה ראשונה']])),
}))
vi.mock('../../server/services/knesset-config', () => ({ getCurrentKnesset: () => 25 }))

const { mockCommitteeListGet } = vi.hoisted(() => ({
  mockCommitteeListGet: vi.fn(),
}))

vi.mock('../../server/repositories/committee-list-repository', () => ({
  CommitteeListRepository: vi.fn().mockImplementation(() => ({
    get: mockCommitteeListGet,
  })),
}))

import { fetchRecentBills, _resetBillsCache, _resetCommitteeMapCache, _resetProgressCache, _resetTrendingCache, fetchPolicyAlignedBills, fetchTrendingBills, LIBERAL_KEYWORDS, getTrendingBills } from '../../server/services/knesset-bills'

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
    vi.mocked(readFile).mockReset()
    mockCommitteeListGet.mockReset()
    mockCommitteeListGet.mockResolvedValue(null)
    _resetBillsCache()
    _resetCommitteeMapCache()
  })

  it('maps OData rows to overview items with resolved status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(RAW))
    const items = await fetchRecentBills(10)
    expect(items).toHaveLength(2)
    expect(items[0].billId).toBe(1044632)
    expect(items[0].status).toBe('הכנה לקריאה ראשונה')
    expect(items[0].summary).toBe('תקציר')
    expect(items[0].knessetUrl).toContain('lawitemid=1044632')
    expect(items[0].committee).toBe('') // cache absent → graceful empty string
  })

  it('resolves committee name from DB cache when CommitteeID is present', async () => {
    mockCommitteeListGet.mockResolvedValueOnce([
      { committeeId: 5, name: 'ועדת הכספים', knessetUrl: '' },
    ])
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(RAW))
    const items = await fetchRecentBills(10)
    expect(items[0].committee).toBe('ועדת הכספים') // CommitteeID=5 → resolved
    expect(items[1].committee).toBe('') // CommitteeID=null → no resolution
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
    // The recency bug was ordering by LastUpdatedDate; guard the ORDER clause
    // specifically (the column still appears in $select to populate lastUpdatedDate).
    expect(calledUrl).not.toContain('$orderby=LastUpdatedDate')
  })

  it('caches results within TTL (one fetch for two calls)', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOdata(RAW))
    await fetchRecentBills(10)
    await fetchRecentBills(10)
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('fetchRecentBills (progress ranking)', () => {
  const POOL = [
    { BillID: 300, Name: 'ג', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '' },
    { BillID: 200, Name: 'ב', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '' },
    { BillID: 100, Name: 'א', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '' },
  ]

  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    mockCommitteeListGet.mockReset()
    mockCommitteeListGet.mockResolvedValue(null)
    _resetBillsCache()
    _resetCommitteeMapCache()
    _resetProgressCache()
  })

  it('re-sorts bills by max CommitteeSessionID descending', async () => {
    // First fetch: bill pool (top 200 by BillID desc)
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(POOL))
    // Second fetch: KNS_CmtSessionItem — bill 100 has the most-recent session, bill 300 has an older one
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([
      { ItemID: 100, CommitteeSessionID: 9000 },
      { ItemID: 300, CommitteeSessionID: 5000 },
    ]))

    const items = await fetchRecentBills(3, 'progress')
    expect(items[0].billId).toBe(100) // highest session ID
    expect(items[1].billId).toBe(300) // second highest
    expect(items[2].billId).toBe(200) // no sessions → score 0, sorts last
  })

  it('returns at most limit items', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(POOL))
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([]))
    const items = await fetchRecentBills(2, 'progress')
    expect(items).toHaveLength(2)
  })

  it('falls through to newest ordering for unknown ranking values', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(POOL))
    const items = await fetchRecentBills(3, 'newest')
    expect(fetch).toHaveBeenCalledOnce() // no second call for CmtSessionItem
    expect(items[0].billId).toBe(300) // BillID desc order preserved
  })

  it('chunks CmtSessionItem requests when pool > 40 and encodes filter URLs', async () => {
    const bigPool = Array.from({ length: 41 }, (_, i) => ({
      BillID: 1000 + i, Name: `חוק ${i}`, StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '',
    }))
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(bigPool)) // pool fetch
    vi.mocked(fetch).mockResolvedValue(mockOdata([]))          // both chunk fetches
    await fetchRecentBills(5, 'progress')
    // pool + 2 chunks (40 + 1)
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(fetch).mock.calls.slice(1)) {
      const url = call[0] as string
      expect(url).not.toContain(' ')     // no raw spaces
      expect(url).toContain('%20')       // properly encoded
    }
  })
})

describe('fetchPolicyAlignedBills', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    mockCommitteeListGet.mockReset()
    mockCommitteeListGet.mockResolvedValue(null)
    _resetBillsCache()
    _resetCommitteeMapCache()
  })

  it('queries keywords in batches with substringof, ordered by BillID desc', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOdata(RAW))
    await fetchPolicyAlignedBills(10)
    expect(LIBERAL_KEYWORDS.length).toBeGreaterThan(0)
    const firstUrl = decodeURIComponent(vi.mocked(fetch).mock.calls[0][0] as string)
    expect(firstUrl).toContain(`substringof('${LIBERAL_KEYWORDS[0]}',Name)`)
    expect(firstUrl).toContain('$orderby=BillID desc')
  })

  it('never issues a query with 3+ substringof clauses (OData 473 guard)', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOdata(RAW))
    await fetchPolicyAlignedBills(10)
    // Six keywords batched in pairs => 3 requests, each with at most 2 substringof clauses
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(fetch).mock.calls) {
      const url = decodeURIComponent(call[0] as string)
      expect((url.match(/substringof\(/g) ?? []).length).toBeLessThanOrEqual(2)
    }
  })

  it('returns merged, deduped items sorted by billId desc', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOdata(RAW))
    const items = await fetchPolicyAlignedBills(10)
    // RAW has billIds 1044632 and 1044000; deduped across batches, sorted desc
    expect(items).toHaveLength(2)
    expect(items[0].billId).toBe(1044632)
    expect(items[1].billId).toBe(1044000)
  })
})

describe('getTrendingBills (manual)', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    vi.mocked(readFile).mockReset()
    mockCommitteeListGet.mockReset()
    mockCommitteeListGet.mockResolvedValue(null)
    _resetBillsCache()
    _resetCommitteeMapCache()
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

describe('fetchTrendingBills (algorithmic)', () => {
  const POOL = [
    { BillID: 300, Name: 'ג', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '' },
    { BillID: 200, Name: 'ב', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '' },
    { BillID: 100, Name: 'א', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '' },
  ]
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    vi.mocked(readFile).mockReset()
    mockCommitteeListGet.mockReset()
    mockCommitteeListGet.mockResolvedValue(null)
    _resetBillsCache()
    _resetCommitteeMapCache()
    _resetTrendingCache()
  })

  it('ranks by co-sponsor count (sponsorship) and drops bills with no signal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(POOL)) // recent-bill pool
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([      // KNS_BillInitiator rows (one per initiator)
      { BillID: 300 }, { BillID: 300 }, { BillID: 300 },
      { BillID: 100 }, { BillID: 100 },
    ]))
    const items = await fetchTrendingBills('sponsorship')
    expect(items.map((b) => b.billId)).toEqual([300, 100]) // 200 has 0 initiators → dropped
    expect(items[0].reason).toBe('ח"כים יוזמים: 3')
  })

  it('ranks by merged-bill count (amendments) keyed on MainBillID', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(POOL))
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([
      { MainBillID: 200 }, { MainBillID: 200 }, { MainBillID: 300 },
    ]))
    const items = await fetchTrendingBills('amendments')
    expect(items.map((b) => b.billId)).toEqual([200, 300])
    expect(items[0].reason).toBe('הצעות שמוזגו: 2')
  })

  it('queries the algorithm-specific OData entity', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(POOL))
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([]))
    await fetchTrendingBills('sponsorship')
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain('KNS_BillInitiator')
  })

  it('falls back to the curated list for manual/unknown algorithms', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ bills: [{ billId: 1044632, title: 'curated', reason: 'סיבה' }] }))
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([
      { BillID: 1044632, Name: 'הצעת חוק א', StatusID: 101, CommitteeID: null, LastUpdatedDate: '2026-05-01', SummaryLaw: '' },
    ]))
    const items = await fetchTrendingBills('manual')
    expect(items[0].billId).toBe(1044632)
    expect(items[0].reason).toBe('סיבה')
    // the curated path reads JSON + hydrates by id — it never queries a trending pool
    const poolCalls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes('$orderby=BillID%20desc'))
    expect(poolCalls).toHaveLength(0)
  })
})
