import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { OknessetClient } from '../../server/services/oknesset'

const client = new OknessetClient()

describe('OknessetClient', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  it('getBill fetches from correct URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, title: 'Test Bill', status: 'committee' }),
    } as Response)

    const bill = await client.getBill('1')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/bill/1'),
      expect.any(Object)
    )
    expect(bill).toMatchObject({ id: 1 })
  })

  it('getBill throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response)

    await expect(client.getBill('999')).rejects.toThrow('oknesset API error: 404')
  })

  it('getMk fetches from correct URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, name: 'Test MK' }),
    } as Response)

    await client.getMk('42')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/member/42'),
      expect.any(Object)
    )
  })

  it('getCommittee fetches from correct URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 7, name: 'Test Committee' }),
    } as Response)

    await client.getCommittee('7')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/committee/7'),
      expect.any(Object)
    )
  })
})
