import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFile } from 'fs/promises'

vi.stubGlobal('fetch', vi.fn())
vi.mock('fs/promises')
vi.mock('../../server/services/bill-status-map', () => ({
  getBillStatusMap: vi.fn(async () => new Map([[101, 'הכנה לקריאה ראשונה']])),
}))
vi.mock('../../server/services/knesset-config', () => ({ getCurrentKnesset: () => 25 }))

import { fetchRecentBills, _resetBillsCache, fetchPolicyAlignedBills, LIBERAL_KEYWORDS, getTrendingBills, getBillsFlags } from '../../server/services/knesset-bills'

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

describe('fetchPolicyAlignedBills', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
    _resetBillsCache()
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
})
