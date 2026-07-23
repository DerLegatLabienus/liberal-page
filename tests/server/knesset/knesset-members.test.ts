import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { fetchAllKnessetMembers } from '../../../server/services/knesset-members'

const PERSONS = [
  { PersonID: 30839, FirstName: 'דן', LastName: 'אילוז' },
  { PersonID: 30870, FirstName: 'משה', LastName: 'רוט' },
]
const FACTION_POSITIONS = [
  { PersonID: 30839, FactionName: 'הליכוד', IsCurrent: true },
  { PersonID: 30870, FactionName: 'הליכוד', IsCurrent: true },
]
const SITE_CODES = [
  { SiteId: 1116, KnsID: 30839 },
  { SiteId: 1117, KnsID: 30870 },
]

// A member's photo now comes from the live header API; this is the URL the mock returns per siteId.
const mkImage = (siteId: number) => `https://fs.knesset.gov.il/globaldocs/MK/${siteId}/1_${siteId}_3_1.jpeg`

function okJson(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

/**
 * Route each fetch by URL rather than by call order: the photo-resolution calls
 * (GetMkdetailsHeader) run after the OData calls and concurrently, so a sequential
 * mockResolvedValueOnce chain would be brittle. `queues` maps an OData entity-set name
 * to a FIFO of response bodies (to model pagination); header calls resolve to their MkImage.
 */
function mockFetch(queues: Record<string, unknown[]>, photo: (siteId: number) => string | null = mkImage) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    const header = url.match(/GetMkdetailsHeader\?mkId=(\d+)/)
    if (header) return okJson({ MkImage: photo(Number(header[1])) })
    for (const [entity, responses] of Object.entries(queues)) {
      // Match on `entity?` so KNS_Person doesn't also catch KNS_PersonToPosition.
      if (url.includes(`${entity}?`)) {
        if (responses.length === 0) throw new Error(`no queued response for ${entity}: ${url}`)
        return okJson(responses.shift())
      }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** OData responses use `value`, with an optional `odata.nextLink` for pagination. */
function page(value: unknown[], nextLink?: string) {
  const body: Record<string, unknown> = { value }
  if (nextLink) body['odata.nextLink'] = nextLink
  return body
}

describe('fetchAllKnessetMembers', () => {
  // Block body (not an implicit return): returning the spy would make vitest treat it as a
  // teardown callback and call fetch() with no args after the test, tripping the mock.
  beforeEach(() => { vi.mocked(fetch).mockReset() })

  it('returns empty array when persons list is empty', async () => {
    mockFetch({ KNS_Person: [page([])] })
    expect(await fetchAllKnessetMembers(25)).toEqual([])
  })

  it('assembles KnessetMember[] with name, siteId, and party', async () => {
    mockFetch({
      KNS_Person: [page(PERSONS)],
      KNS_PersonToPosition: [page(FACTION_POSITIONS)],
      KNS_MkSiteCode: [page(SITE_CODES)],
    })

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(2)
    expect(result[0].siteId).toBe(1116)
    expect(result[0].name).toBe('דן אילוז')
    expect(result[0].party).toBe('הליכוד')
    expect(result[0].isLiberal).toBe(false)
  })

  it('follows odata.nextLink to collect all pages', async () => {
    mockFetch({
      KNS_Person: [page([PERSONS[0]], 'KNS_Person?$skiptoken=30839'), page([PERSONS[1]])],
      KNS_PersonToPosition: [page(FACTION_POSITIONS)],
      KNS_MkSiteCode: [page(SITE_CODES)],
    })

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(2)
    // Verify a fetch used the nextLink skiptoken
    const usedNextLink = vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('skiptoken=30839'))
    expect(usedNextLink).toBe(true)
  })

  it('collects all 120 MKs across two pages (100 + 20)', async () => {
    const page1Persons = Array.from({ length: 100 }, (_, i) => ({
      PersonID: 1000 + i, FirstName: `פרטי${i}`, LastName: `משפחה${i}`,
    }))
    const page2Persons = Array.from({ length: 20 }, (_, i) => ({
      PersonID: 2000 + i, FirstName: `פרטי${100 + i}`, LastName: `משפחה${100 + i}`,
    }))
    const allPersons = [...page1Persons, ...page2Persons]
    const allSiteCodes = allPersons.map((p, i) => ({ SiteId: 100 + i, KnsID: p.PersonID }))
    const allFactionPositions = allPersons.map((p) => ({ PersonID: p.PersonID, FactionName: 'הליכוד', IsCurrent: true }))

    // BATCH_SIZE = 40, so 120 persons = 3 batches each for factions and site codes
    mockFetch({
      KNS_Person: [page(page1Persons, 'KNS_Person?$skiptoken=1099'), page(page2Persons)],
      KNS_PersonToPosition: [
        page(allFactionPositions.slice(0, 40)),
        page(allFactionPositions.slice(40, 80)),
        page(allFactionPositions.slice(80)),
      ],
      KNS_MkSiteCode: [
        page(allSiteCodes.slice(0, 40)),
        page(allSiteCodes.slice(40, 80)),
        page(allSiteCodes.slice(80)),
      ],
    })

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(120)
    const page2SiteIds = allSiteCodes.slice(100).map((sc) => sc.SiteId)
    const resultSiteIds = result.map((m) => m.siteId)
    expect(page2SiteIds.every((id) => resultSiteIds.includes(id))).toBe(true)
  })

  it('excludes persons with no site code entry', async () => {
    const personNoSite = { PersonID: 99999, FirstName: 'ללא', LastName: 'קוד' }
    mockFetch({
      KNS_Person: [page([...PERSONS, personNoSite])],
      KNS_PersonToPosition: [page(FACTION_POSITIONS)],
      KNS_MkSiteCode: [page(SITE_CODES)],
    })

    const result = await fetchAllKnessetMembers(25)
    expect(result).toHaveLength(2)
  })

  it('resolves each photo from the live header API (MkImage)', async () => {
    mockFetch({
      KNS_Person: [page([PERSONS[0]])],
      KNS_PersonToPosition: [page([FACTION_POSITIONS[0]])],
      KNS_MkSiteCode: [page([SITE_CODES[0]])],
    })

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].photoUrl).toBe(mkImage(1116))
  })

  it('leaves photoUrl null when the header API has no image', async () => {
    mockFetch({
      KNS_Person: [page([PERSONS[0]])],
      KNS_PersonToPosition: [page([FACTION_POSITIONS[0]])],
      KNS_MkSiteCode: [page([SITE_CODES[0]])],
    }, () => null)

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].photoUrl).toBeNull()
  })

  it('trims trailing spaces from party name', async () => {
    mockFetch({
      KNS_Person: [page([PERSONS[0]])],
      KNS_PersonToPosition: [page([{ ...FACTION_POSITIONS[0], FactionName: 'הליכוד ' }])],
      KNS_MkSiteCode: [page([SITE_CODES[0]])],
    })

    const result = await fetchAllKnessetMembers(25)
    expect(result[0].party).toBe('הליכוד')
  })
})
