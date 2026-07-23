import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchBills } from '../../../server/services/knesset-bills'

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('searchBills', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('maps OData rows to BillSearchResult with a knessetUrl', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      mockJson({ value: [{ BillID: 123, Name: '  חוק חופש המידע  ', StatusID: 5 }] })
    )
    const results = await searchBills('חופש', 25)
    expect(results).toEqual([
      {
        billId: 123,
        name: 'חוק חופש המידע',
        knessetUrl: 'https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=123',
      },
    ])
    // query went to KNS_Bill with the knesset filter
    expect(String(fetchMock.mock.calls[0][0])).toContain('KNS_Bill?$filter=KnessetNum%20eq%2025')
  })

  it('returns an empty array when there are no matches', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({ value: [] }))
    expect(await searchBills('zzz', 25)).toEqual([])
  })
})
