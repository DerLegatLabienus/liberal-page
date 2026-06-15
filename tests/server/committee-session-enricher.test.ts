import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { enrichCommitteeSessions } from '../../server/services/committee-session-enricher'

const ODATA_COMMITTEE = [{ CommitteeID: 4186, Name: 'ועדת הכספים' }]
const ODATA_SESSIONS = [
  {
    CommitteeSessionID: 2242870,
    StartDate: '2026-05-13T09:30:00',
    KnessetNum: 25,
    SessionUrl: 'http://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2242870',
  },
  {
    CommitteeSessionID: 2241000,
    StartDate: '2026-04-30T10:00:00',
    KnessetNum: 25,
    SessionUrl: 'http://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2241000',
  },
]
const ODATA_ITEMS = [
  { Name: 'הצעת חוק לתיקון פקודת מס הכנסה', Ordinal: 1 },
]

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

describe('enrichCommitteeSessions', () => {
  beforeEach(() => vi.mocked(fetch).mockReset())

  it('returns 2 sessions with titles from agenda items', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(ODATA_COMMITTEE)) // name lookup
      .mockResolvedValueOnce(mockOdata(ODATA_SESSIONS))  // sessions
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))     // items session 1
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))     // items session 2

    const result = await enrichCommitteeSessions('ועדת הכספים', [], false)
    expect(result).toHaveLength(2)
    expect(result[0].sessionId).toBe(2242870)
    expect(result[0].title).toBe('הצעת חוק לתיקון פקודת מס הכנסה')
    expect(result[0].knessetNum).toBe(25)
    // URL must come from OData SessionUrl (http → https upgrade), not a custom-built path
    expect(result[0].sessionUrl).toBe(
      'https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteesAgenda.aspx?Tab=3&ItemID=2242870'
    )
    expect(result[0].attendingSiteIds).toEqual([])
    expect(result[0].aiSummary).toBeUndefined()
  })

  it('resolves the newest committee term (orderby KnessetNum desc, not the unreliable IsCurrent flag)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(ODATA_COMMITTEE))
      .mockResolvedValueOnce(mockOdata(ODATA_SESSIONS))
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))

    await enrichCommitteeSessions('ועדת הכספים', [], false)

    // The Knesset OData marks IsCurrent=true on multiple historical instances of a same-named
    // committee, so the lookup must order by KnessetNum desc + top 1 instead of trusting IsCurrent.
    const committeeCall = vi.mocked(fetch).mock.calls[0][0] as string
    expect(committeeCall).toContain('orderby=KnessetNum')
    expect(committeeCall).toContain('desc')
    expect(committeeCall).toContain('top=1')
    expect(committeeCall).not.toContain('IsCurrent')
  })

  it('session query uses $top=5', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(ODATA_COMMITTEE))
      .mockResolvedValueOnce(mockOdata(ODATA_SESSIONS))
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))
      .mockResolvedValueOnce(mockOdata(ODATA_ITEMS))

    await enrichCommitteeSessions('ועדת הכספים', [], false)

    const sessionCall = vi.mocked(fetch).mock.calls[1][0] as string
    expect(sessionCall).toContain('$top=5')
  })

  it('returns empty title when no agenda items and AI is off', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(ODATA_COMMITTEE))
      .mockResolvedValueOnce(mockOdata([ODATA_SESSIONS[0]]))
      .mockResolvedValueOnce(mockOdata([]))  // no agenda items

    const result = await enrichCommitteeSessions('ועדת הכספים', [], false)
    expect(result[0].title).toBe('')
  })

  it('returns empty array when committee not found', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([]))
    const result = await enrichCommitteeSessions('ועדה לא קיימת', [], false)
    expect(result).toEqual([])
  })

  it('returns empty array on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))
    const result = await enrichCommitteeSessions('ועדת הכספים', [], false)
    expect(result).toEqual([])
  })
})
