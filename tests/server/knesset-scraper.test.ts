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
        LastUpdatedDate: '2026-03-29T00:00:00',
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
        LastUpdatedDate: '2024-01-01T00:00:00',
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
