import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { fetchAllKnessetMembers } from '../../server/services/knesset-members'

const SITE_CODES = [
  { SiteId: 1116, KnsID: 30839, KnessetNum: 25 },
  { SiteId: 1117, KnsID: 30870, KnessetNum: 25 },
]
const PERSONS = [
  { PersonID: 30839, FirstName: 'דן', LastName: 'אילוז', PictureDeputyUrl: null },
  { PersonID: 30870, FirstName: 'משה', LastName: 'רוט', PictureDeputyUrl: null },
]
const FACTIONS = [{ FactionID: 10, Name: 'הליכוד', KnessetNum: 25 }]
const POSITIONS = [
  { PersonID: 30839, FactionID: 10, IsCurrent: true },
  { PersonID: 30870, FactionID: 10, IsCurrent: true },
]

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

describe('fetchAllKnessetMembers', () => {
  beforeEach(() => vi.mocked(fetch).mockReset())

  it('returns empty array when site codes list is empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata([]))
    expect(await fetchAllKnessetMembers(25)).toEqual([])
  })

  it('assembles KnessetMember[] with name, siteId, and party', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(SITE_CODES))  // site codes page 1 (< PAGE_SIZE → done)
      .mockResolvedValueOnce(mockOdata(PERSONS))      // persons batch
      .mockResolvedValueOnce(mockOdata(FACTIONS))     // factions
      .mockResolvedValueOnce(mockOdata(POSITIONS))    // positions batch

    const result = await fetchAllKnessetMembers(25)

    expect(result).toHaveLength(2)
    expect(result[0].siteId).toBe(1116)
    expect(result[0].name).toBe('דן אילוז')
    expect(result[0].party).toBe('הליכוד')
    expect(result[0].isLiberal).toBe(false)
    expect(result[0].isSupporter).toBe(false)
  })

  it('paginates when first page returns full page size', async () => {
    // Simulate PAGE_SIZE = 50: first page full, second page empty
    const page1 = Array.from({ length: 50 }, (_, i) => ({ SiteId: i + 1, KnsID: i + 1, KnessetNum: 25 }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(page1))    // page 1 — full, triggers next
      .mockResolvedValueOnce(mockOdata([]))        // page 2 — empty, stops
      .mockResolvedValueOnce(mockOdata([]))        // persons batch 1 (IDs 1-40)
      .mockResolvedValueOnce(mockOdata([]))        // persons batch 2 (IDs 41-50)
      .mockResolvedValueOnce(mockOdata([]))        // factions
      .mockResolvedValueOnce(mockOdata([]))        // positions batch 1 (IDs 1-40)
      .mockResolvedValueOnce(mockOdata([]))        // positions batch 2 (IDs 41-50)

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(50)
    // Verify that fetch was called twice for site codes (pagination)
    const siteCalls = vi.mocked(fetch).mock.calls.filter(([url]) =>
      (url as string).includes('KNS_MkSiteCode')
    )
    expect(siteCalls).toHaveLength(2)
  })

  it('derives photo URL from siteId when PictureDeputyUrl is null', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([SITE_CODES[0]]))
      .mockResolvedValueOnce(mockOdata([PERSONS[0]]))
      .mockResolvedValueOnce(mockOdata(FACTIONS))
      .mockResolvedValueOnce(mockOdata([POSITIONS[0]]))

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].photoUrl).toBe('https://www.knesset.gov.il/mk/images/members/mk_1116.jpg')
  })

  it('uses PictureDeputyUrl when present', async () => {
    const personWithPhoto = { ...PERSONS[0], PictureDeputyUrl: '/mk/images/members/mk_1116.jpg' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata([SITE_CODES[0]]))
      .mockResolvedValueOnce(mockOdata([personWithPhoto]))
      .mockResolvedValueOnce(mockOdata(FACTIONS))
      .mockResolvedValueOnce(mockOdata([POSITIONS[0]]))

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].photoUrl).toBe('https://www.knesset.gov.il/mk/images/members/mk_1116.jpg')
  })
})
