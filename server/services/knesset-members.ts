import { getCurrentKnesset } from './knesset-config'
import type { KnessetMember } from '../../src/types'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const BATCH_SIZE = 40
const FACTION_POSITION_ID = 54 // "חבר/ת סיעה" — has FactionName directly

interface SiteCodeRow { SiteId: number; KnsID: number }
interface PersonRow { PersonID: number; FirstName: string; LastName: string; PictureDeputyUrl?: string | null }
interface FactionPositionRow { PersonID: number; FactionName: string | null }

async function odataFetch<T>(path: string): Promise<T[]> {
  const res = await fetch(`${ODATA_BASE}/${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OData error ${res.status}: ${path}`)
  const data = await res.json() as { value?: T[]; 'odata.nextLink'?: string }
  return data.value ?? []
}

// Follows odata.nextLink pagination to collect all pages
async function odataFetchAll<T>(path: string): Promise<T[]> {
  const results: T[] = []
  let nextPath: string | null = path

  while (nextPath) {
    const res = await fetch(`${ODATA_BASE}/${nextPath}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`OData error ${res.status}: ${nextPath}`)
    const data = await res.json() as { value?: T[]; 'odata.nextLink'?: string }
    results.push(...(data.value ?? []))
    // nextLink is a relative URL like "KNS_Person?$filter=...&$skiptoken=N"
    nextPath = data['odata.nextLink'] ?? null
  }

  return results
}

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
  return knsIds
    .filter((id) => knsIdToSiteId.has(id))
    .map((id) => {
      const person = personMap.get(id)!
      const siteId = knsIdToSiteId.get(id)!
      const pictureUrl = person.PictureDeputyUrl
      const photoUrl = pictureUrl
        ? `https://www.knesset.gov.il${pictureUrl}`
        : `https://www.knesset.gov.il/mk/images/members/mk_${siteId}.jpg`
      return {
        siteId,
        name: `${person.FirstName} ${person.LastName}`.trim(),
        party: personFactionMap.get(id) ?? '',
        photoUrl,
        isLiberal: false,
        isSupporter: false,
      }
    })
}
