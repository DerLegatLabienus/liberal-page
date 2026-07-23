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
