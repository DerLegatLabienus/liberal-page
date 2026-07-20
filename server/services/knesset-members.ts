import type { KnessetMember } from '../../src/types'
import { odataGet, odataGetAllPages } from './odata'
import { fetchMkImageUrl } from './knesset-scraper'

const BATCH_SIZE = 40
const FACTION_POSITION_ID = 54 // "חבר/ת סיעה" — has FactionName directly
const PHOTO_CONCURRENCY = 8

interface SiteCodeRow { SiteId: number; KnsID: number }
interface PersonRow { PersonID: number; FirstName: string; LastName: string }
interface FactionPositionRow { PersonID: number; FactionName: string | null }

const odataFetch = <T>(path: string): Promise<T[]> => odataGet<T>(path, { errorContext: 'OData' })
const odataFetchAll = <T>(path: string): Promise<T[]> => odataGetAllPages<T>(path, { errorContext: 'OData' })

export async function fetchAllKnessetMembers(): Promise<KnessetMember[]> {
  // Step 1: get all current MKs — follow odata.nextLink across pages (API caps at 100/page)
  const persons = await odataFetchAll<PersonRow>(
    `KNS_Person?$filter=IsCurrent%20eq%20true&$top=200&$format=json`
  )
  if (!persons.length) return []

  const knsIds = persons.map((p) => p.PersonID)
  const personMap = new Map(persons.map((p) => [p.PersonID, p]))

  // Step 2: batch-fetch faction memberships (PositionID 54 has FactionName directly)
  const factionPositions: FactionPositionRow[] = []
  for (let i = 0; i < knsIds.length; i += BATCH_SIZE) {
    const batch = knsIds.slice(i, i + BATCH_SIZE)
    const filter = batch.map((id) => `PersonID%20eq%20${id}`).join('%20or%20')
    const page = await odataFetch<FactionPositionRow>(
      `KNS_PersonToPosition?$filter=(${filter})%20and%20PositionID%20eq%20${FACTION_POSITION_ID}%20and%20IsCurrent%20eq%20true&$top=100&$format=json`
    )
    factionPositions.push(...page)
  }
  const personFactionMap = new Map<number, string>()
  for (const pos of factionPositions) {
    if (!personFactionMap.has(pos.PersonID) && pos.FactionName) {
      personFactionMap.set(pos.PersonID, pos.FactionName.trim())
    }
  }

  // Step 3: batch-fetch SiteIds from KNS_MkSiteCode
  const siteCodes: SiteCodeRow[] = []
  for (let i = 0; i < knsIds.length; i += BATCH_SIZE) {
    const batch = knsIds.slice(i, i + BATCH_SIZE)
    const filter = batch.map((id) => `KnsID%20eq%20${id}`).join('%20or%20')
    const page = await odataFetch<SiteCodeRow>(
      `KNS_MkSiteCode?$filter=${filter}&$top=100&$format=json`
    )
    siteCodes.push(...page)
  }
  const knsIdToSiteId = new Map(siteCodes.map((sc) => [sc.KnsID, sc.SiteId]))

  // Step 4: assemble — only MKs who have a site code
  const members: KnessetMember[] = knsIds
    .filter((id) => knsIdToSiteId.has(id))
    .map((id) => {
      const person = personMap.get(id)!
      return {
        siteId: knsIdToSiteId.get(id)!,
        name: `${person.FirstName} ${person.LastName}`.trim(),
        party: personFactionMap.get(id) ?? '',
        photoUrl: null,
        isLiberal: false,
        isSupporter: false,
      }
    })

  // Step 5: resolve each photo from the live header API (OData no longer carries it).
  // Bounded concurrency, per-MK null fallback so one failure can't fail the whole refresh.
  for (let i = 0; i < members.length; i += PHOTO_CONCURRENCY) {
    const chunk = members.slice(i, i + PHOTO_CONCURRENCY)
    await Promise.all(chunk.map(async (m) => { m.photoUrl = await fetchMkImageUrl(m.siteId) }))
  }

  return members
}
