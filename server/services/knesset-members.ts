import type { KnessetMember } from '../../src/types'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const PAGE_SIZE = 50
const BATCH_SIZE = 40

interface SiteCodeRow { SiteId: number; KnsID: number; KnessetNum: number }
interface PersonRow { PersonID: number; FirstName: string; LastName: string; PictureDeputyUrl?: string | null }
interface PositionRow { PersonID: number; FactionID: number | null; IsCurrent: boolean }
interface FactionRow { FactionID: number; Name: string; KnessetNum: number }

async function odataFetch<T>(path: string): Promise<T[]> {
  const res = await fetch(`${ODATA_BASE}/${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OData error ${res.status}: ${path}`)
  const data = await res.json() as { value?: T[] }
  return data.value ?? []
}

export async function fetchAllKnessetMembers(knessetNum: number): Promise<KnessetMember[]> {
  // Step 1: paginate KNS_MkSiteCode for all site codes in this knesset
  const siteCodes: SiteCodeRow[] = []
  let skip = 0
  while (true) {
    const page = await odataFetch<SiteCodeRow>(
      `KNS_MkSiteCode?$filter=KnessetNum%20eq%20${knessetNum}&$top=${PAGE_SIZE}&$skip=${skip}&$format=json`
    )
    siteCodes.push(...page)
    if (page.length < PAGE_SIZE) break
    skip += PAGE_SIZE
  }
  if (!siteCodes.length) return []

  const knsIds = [...new Set(siteCodes.map((r) => r.KnsID))]

  // Step 2: batch-fetch all persons
  const persons: PersonRow[] = []
  for (let i = 0; i < knsIds.length; i += BATCH_SIZE) {
    const batch = knsIds.slice(i, i + BATCH_SIZE)
    const filter = batch.map((id) => `PersonID%20eq%20${id}`).join('%20or%20')
    const page = await odataFetch<PersonRow>(
      `KNS_Person?$filter=${filter}&$top=${BATCH_SIZE}&$format=json`
    )
    persons.push(...page)
  }
  const personMap = new Map(persons.map((p) => [p.PersonID, p]))

  // Step 3: fetch all factions for this knesset
  const factions = await odataFetch<FactionRow>(
    `KNS_Faction?$filter=KnessetNum%20eq%20${knessetNum}&$format=json`
  )
  const factionMap = new Map(factions.map((f) => [f.FactionID, f.Name]))

  // Step 4: batch-fetch current positions to resolve party names
  const positions: PositionRow[] = []
  for (let i = 0; i < knsIds.length; i += BATCH_SIZE) {
    const batch = knsIds.slice(i, i + BATCH_SIZE)
    const filter = batch.map((id) => `PersonID%20eq%20${id}`).join('%20or%20')
    const page = await odataFetch<PositionRow>(
      `KNS_PersonToPosition?$filter=(${filter})%20and%20IsCurrent%20eq%20true%20and%20FactionID%20ne%20null&$top=100&$format=json`
    )
    positions.push(...page)
  }
  const personPartyMap = new Map<number, string>()
  for (const pos of positions) {
    if (!personPartyMap.has(pos.PersonID) && pos.FactionID != null) {
      personPartyMap.set(pos.PersonID, factionMap.get(pos.FactionID) ?? '')
    }
  }

  // Step 5: assemble
  return siteCodes.map((sc) => {
    const person = personMap.get(sc.KnsID)
    const name = person ? `${person.FirstName} ${person.LastName}`.trim() : `MK ${sc.SiteId}`
    const pictureUrl = person?.PictureDeputyUrl
    const photoUrl = pictureUrl
      ? `https://www.knesset.gov.il${pictureUrl}`
      : `https://www.knesset.gov.il/mk/images/members/mk_${sc.SiteId}.jpg`
    return {
      siteId: sc.SiteId,
      name,
      party: personPartyMap.get(sc.KnsID) ?? '',
      photoUrl,
      isLiberal: false,
      isSupporter: false,
    }
  })
}
