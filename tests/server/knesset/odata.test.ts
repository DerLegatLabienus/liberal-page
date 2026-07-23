import { describe, it, expect, vi, beforeEach } from 'vitest'
import { odataGet, odataGetAllPages } from '../../../server/services/odata'

const BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

function mockJson(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

describe('odataGet', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('composes the base URL with the given path and sends the default Accept header', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({ value: [{ a: 1 }] }))
    const out = await odataGet<{ a: number }>('KNS_Bill?$top=1')
    expect(out).toEqual([{ a: 1 }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/KNS_Bill?$top=1`)
    expect((init as RequestInit).headers).toMatchObject({ Accept: 'application/json' })
  })

  it('merges caller headers over the default', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({ value: [] }))
    await odataGet('KNS_Bill', { headers: { 'X-Test': '1' } })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ Accept: 'application/json', 'X-Test': '1' })
  })

  it('throws on non-OK, including the path and the errorContext prefix', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({}, false, 500))
    await expect(odataGet('KNS_Bill?$top=1', { errorContext: 'Knesset OData' }))
      .rejects.toThrow('Knesset OData error 500: KNS_Bill?$top=1')
  })

  it('throws with the path even without an errorContext', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({}, false, 404))
    await expect(odataGet('KNS_X')).rejects.toThrow(/404: KNS_X/)
  })

  it('parses { value: [...] }', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({ value: [{ id: 1 }, { id: 2 }] }))
    expect(await odataGet('p')).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('parses a bare array', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJson([{ id: 1 }]))
    expect(await odataGet('p')).toEqual([{ id: 1 }])
  })

  it('wraps a single object into a one-element array', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({ id: 9 }))
    expect(await odataGet('p')).toEqual([{ id: 9 }])
  })

  it('forwards an AbortSignal', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({ value: [] }))
    const ctrl = new AbortController()
    await odataGet('p', { signal: ctrl.signal })
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(ctrl.signal)
  })
})

describe('odataGetAllPages', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('follows odata.nextLink across pages and concatenates results', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockJson({ value: [{ id: 1 }], 'odata.nextLink': 'KNS_X?$skiptoken=1' }))
      .mockResolvedValueOnce(mockJson({ value: [{ id: 2 }] }))
    const out = await odataGetAllPages<{ id: number }>('KNS_X')
    expect(out).toEqual([{ id: 1 }, { id: 2 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/KNS_X`)
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/KNS_X?$skiptoken=1`)
  })

  it('returns a single page when there is no nextLink', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(mockJson({ value: [{ id: 1 }] }))
    expect(await odataGetAllPages('KNS_X')).toEqual([{ id: 1 }])
  })
})
