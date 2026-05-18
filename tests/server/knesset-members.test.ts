import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { fetchAllKnessetMembers } from '../../server/services/knesset-members'

const PERSONS = [
  { PersonID: 30839, FirstName: 'דן', LastName: 'אילוז', PictureDeputyUrl: null },
  { PersonID: 30870, FirstName: 'משה', LastName: 'רוט', PictureDeputyUrl: null },
]
const FACTION_POSITIONS = [
  { PersonID: 30839, FactionName: 'הליכוד', IsCurrent: true },
  { PersonID: 30870, FactionName: 'הליכוד', IsCurrent: true },
]
const SITE_CODES = [
  { SiteId: 1116, KnsID: 30839 },
  { SiteId: 1117, KnsID: 30870 },
]

function mockOdata(value: unknown[], nextLink?: string) {
  const body: Record<string, unknown> = { value }
  if (nextLink) body['odata.nextLink'] = nextLink
  return { ok: true, json: async () => body } as Response
}

describe('fetchAllKnessetMembers', () => {
  beforeEach(() => vi.mocked(fetch).mockReset())

  it('returns empty array when persons list is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([]))
    expect(await fetchAllKnessetMembers(25)).toEqual([])
  })

  it('assembles KnessetMember[] with name, siteId, and party', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(PERSONS))           // KNS_Person page 1, no nextLink
      .mockResolvedValueOnce(mockOdata(FACTION_POSITIONS)) // faction batch 1
      .mockResolvedValueOnce(mockOdata(SITE_CODES))        // site codes batch 1

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(2)
    expect(result[0].siteId).toBe(1116)
    expect(result[0].name).toBe('דן אילוז')
    expect(result[0].party).toBe('הליכוד')
    expect(result[0].isLiberal).toBe(false)
  })

  it('follows odata.nextLink to collect all pages', async () => {
    const page1 = [PERSONS[0]]
    const page2 = [PERSONS[1]]
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(page1, 'KNS_Person?$skiptoken=30839'))  // page 1 + nextLink
      .mockResolvedValueOnce(mockOdata(page2))                                  // page 2, no nextLink
      .mockResolvedValueOnce(mockOdata(FACTION_POSITIONS))                      // faction batch
      .mockResolvedValueOnce(mockOdata(SITE_CODES))                             // site codes batch

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(2)
    // Verify second fetch used the nextLink
    const calls = vi.mocked(fetch).mock.calls
    expect((calls[1][0] as string)).toContain('skiptoken=30839')
  })

  it('excludes persons with no site code entry', async () => {
    const personNoSite = { PersonID: 99999, FirstName: 'ללא', LastName: 'קוד', PictureDeputyUrl: null }
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([...PERSONS, personNoSite]))
      .mockResolvedValueOnce(mockOdata(FACTION_POSITIONS))
      .mockResolvedValueOnce(mockOdata(SITE_CODES))

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(2)
  })

  it('derives photo URL from siteId when PictureDeputyUrl is null', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([PERSONS[0]]))
      .mockResolvedValueOnce(mockOdata([FACTION_POSITIONS[0]]))
      .mockResolvedValueOnce(mockOdata([SITE_CODES[0]]))

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].photoUrl).toBe('https://www.knesset.gov.il/mk/images/members/mk_1116.jpg')
  })

  it('trims trailing spaces from party name', async () => {
    const posWithSpace = { ...FACTION_POSITIONS[0], FactionName: 'הליכוד ' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([PERSONS[0]]))
      .mockResolvedValueOnce(mockOdata([posWithSpace]))
      .mockResolvedValueOnce(mockOdata([SITE_CODES[0]]))

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].party).toBe('הליכוד')
  })
})
