import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { fetchMkActivity, fetchMkImageUrl, fetchMkEmail } from '../../server/services/knesset-scraper'

const ACTIVITY_RESPONSE = {
  PrivateBills: [
    {
      Date: '2026-02-23T00:00:00',
      InitiatiorType: 'יוזם',
      Name: 'הצעת חוק למניעת הפצת תוכן פוגעני ברשת החברתית',
      BillLink: '/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=2236954',
    },
    {
      Date: '2026-02-16T00:00:00',
      InitiatiorType: 'יוזם',
      Name: 'הצעת חוק יום לציון מורשת יהדות הודו',
      BillLink: '/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=2239944',
    },
  ],
  PlenaryVotes: [
    {
      Date: '13/05/2026, בשעה 11:42',
      VoteResult: 'הצביע נגד',
      Name: 'הצעת חוק דחיית מועדים',
      VoteID: 45944,
    },
  ],
  Queries: [
    {
      ID: 2216989,
      Date: '2024-04-01T17:12:03.074',
      QueryType: 'רגילה',
      Subject: 'קיצוץ התקציב לאולפני השוברים',
    },
    {
      ID: 2216989,
      Date: '2024-04-01T17:12:03.074',
      QueryType: 'רגילה',
      Subject: 'קיצוץ התקציב לאולפני השוברים',
    },
  ],
  AgendaProposals: [],
}

describe('fetchMkActivity', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  it('merges bills, votes and questions sorted newest first', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ACTIVITY_RESPONSE } as Response)

    const result = await fetchMkActivity(1116, 10)

    expect(result[0].date).toBe('2026-05-13T11:42:00')
    expect(result[0].type).toBe('vote')
    expect(result[0].detail).toBe('הצביע נגד')
    expect(result[1].date).toBe('2026-02-23T00:00:00')
    expect(result[1].type).toBe('bill_initiated')
    expect(result[2].date).toBe('2026-02-16T00:00:00')
    expect(result[2].type).toBe('bill_initiated')
    expect(result[3].type).toBe('question')
  })

  it('deduplicates queries by ID', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ACTIVITY_RESPONSE } as Response)

    const result = await fetchMkActivity(1116, 10)
    const questions = result.filter((r) => r.type === 'question')
    expect(questions).toHaveLength(1)
  })

  it('respects the limit parameter', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ACTIVITY_RESPONSE } as Response)

    const result = await fetchMkActivity(1116, 2)
    expect(result).toHaveLength(2)
  })

  it('throws when fetch fails (after retries are exhausted)', async () => {
    // fetchWithTimeout retries transient failures, so reject persistently, not just once.
    vi.mocked(fetch).mockRejectedValue(new Error('network error'))

    await expect(fetchMkActivity(1116)).rejects.toThrow('network error')
  })

  it('bill sourceUrl includes full knesset domain', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ACTIVITY_RESPONSE } as Response)

    const result = await fetchMkActivity(1116, 10)
    const bill = result.find((r) => r.type === 'bill_initiated')!
    expect(bill.sourceUrl).toMatch(/^https:\/\/main\.knesset\.gov\.il/)
    expect(bill.sourceUrl).toContain('2236954')
  })

  it('vote sourceUrl includes VoteID', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ACTIVITY_RESPONSE } as Response)

    const result = await fetchMkActivity(1116, 10)
    const vote = result.find((r) => r.type === 'vote')!
    expect(vote.sourceUrl).toContain('45944')
  })
})

describe('fetchMkImageUrl', () => {
  const IMG = 'https://fs.knesset.gov.il/globaldocs/MK/1116/1_1116_3_19861.jpeg?v=20260719_25594'

  beforeEach(() => { vi.mocked(fetch).mockReset() })

  it('returns the MkImage URL from GetMkdetailsHeader', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ MkImage: IMG }) } as Response)

    expect(await fetchMkImageUrl(1116)).toBe(IMG)
    expect((vi.mocked(fetch).mock.calls[0][0] as string)).toContain('GetMkdetailsHeader?mkId=1116')
  })

  it('returns null on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response)
    expect(await fetchMkImageUrl(1116)).toBeNull()
  })

  it('returns null when the body is an HTML bot page (non-JSON)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } } as unknown as Response)
    expect(await fetchMkImageUrl(1116)).toBeNull()
  })

  it('falls back to LobbyImage when MkImage is null (Norwegian-Law ministers)', async () => {
    const lobby = 'https://fs.knesset.gov.il/globaldocs/MK/831/1_831_3_1946.jpeg'
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ MkImage: null, LobbyImage: lobby }) } as Response)
    expect(await fetchMkImageUrl(831)).toBe(lobby)
  })

  it('returns null when neither MkImage nor LobbyImage is an absolute URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ MkImage: null, LobbyImage: null }) } as Response)
    expect(await fetchMkImageUrl(1116)).toBeNull()

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ MkImage: '/relative/path.png' }) } as Response)
    expect(await fetchMkImageUrl(1116)).toBeNull()
  })

  it('returns null when fetch rejects (after retries)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network error'))
    expect(await fetchMkImageUrl(1116)).toBeNull()
  })
})

describe('fetchMkEmail', () => {
  beforeEach(() => { vi.mocked(fetch).mockReset() })

  it('returns the Email from GetMkdetailsHeader', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ Email: 'danillouz@knesset.gov.il' }) } as Response)
    expect(await fetchMkEmail(1116)).toBe('danillouz@knesset.gov.il')
    expect((vi.mocked(fetch).mock.calls[0][0] as string)).toContain('GetMkdetailsHeader?mkId=1116')
  })

  it('returns null for an empty email (Norwegian-Law minister)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ Email: '' }) } as Response)
    expect(await fetchMkEmail(831)).toBeNull()
  })

  it('returns null on a non-ok response or network failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response)
    expect(await fetchMkEmail(1116)).toBeNull()

    vi.mocked(fetch).mockRejectedValue(new Error('network error'))
    expect(await fetchMkEmail(1116)).toBeNull()
  })
})
