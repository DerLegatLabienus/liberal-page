import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())
vi.mock('../../server/services/bill-status-map', () => ({
  getBillStatusMap: vi.fn(async () => new Map([[101, 'הכנה לקריאה ראשונה']])),
}))
vi.mock('../../server/services/knesset-config', () => ({ getCurrentKnesset: () => 25 }))

import { fetchRecentBills, _resetBillsCache, fetchPolicyAlignedBills, LIBERAL_KEYWORDS } from '../../server/services/knesset-bills'

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
