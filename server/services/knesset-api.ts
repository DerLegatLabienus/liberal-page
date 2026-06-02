/**
 * Client for the Knesset OData API (knesset.gov.il)
 *
 * ID mapping for MK URLs:
 *   knesset.gov.il uses a "SiteId" in URLs (e.g. /mk/Apps/mk/mk-positions/1116)
 *   The OData API uses an internal "KnsID" (PersonID) which must be looked up via KNS_MkSiteCode.
 */

import { odataGet } from './odata'

const odata = <T>(path: string): Promise<T[]> => odataGet<T>(path, { errorContext: 'Knesset OData' })

interface KNS_MkSiteCode {
  MKSiteCode: number
  KnsID: number
  SiteId: number
}

interface KNS_Person {
  PersonID: number
  FirstName: string
  LastName: string
  Email: string | null
  IsCurrent: boolean
}

interface KNS_PersonToPosition {
  PersonID: number
  PositionID: number
  FactionID: number | null
  IsCurrent: boolean
  StartDate: string | null
  FinishDate: string | null
  DutyDesc: string | null
}

interface KNS_Faction {
  FactionID: number
  Name: string
  KnessetNum: number
  IsCurrent: boolean
}

export interface KnessetMkData {
  knsId: number
  siteId: number
  name: string
  email: string | null
  faction: string | null
  isCurrent: boolean
  positions: Array<{ positionId: number; isCurrent: boolean; startDate: string | null }>
}

/** Resolve a website SiteId to the internal KnsID */
async function resolveSiteIdToKnsId(siteId: number): Promise<number> {
  const records = await odata<KNS_MkSiteCode>(
    `KNS_MkSiteCode?$filter=SiteId%20eq%20${siteId}&$top=1&$format=json`
  )
  if (!records.length) throw new Error(`MK SiteId ${siteId} not found in KNS_MkSiteCode`)
  return records[0].KnsID
}

/** Fetch full MK data given a website SiteId */
export async function getMkBySiteId(siteId: number): Promise<KnessetMkData> {
  const knsId = await resolveSiteIdToKnsId(siteId)
  return getMkByKnsId(knsId, siteId)
}

/** Fetch full MK data given the internal KnsID */
export async function getMkByKnsId(knsId: number, siteId?: number): Promise<KnessetMkData> {
  const [persons, positions] = await Promise.all([
    odata<KNS_Person>(`KNS_Person?$filter=PersonID%20eq%20${knsId}&$top=1&$format=json`),
    odata<KNS_PersonToPosition>(
      `KNS_PersonToPosition?$filter=PersonID%20eq%20${knsId}&$format=json`
    ),
  ])

  if (!persons.length) throw new Error(`MK PersonID ${knsId} not found`)
  const person = persons[0]

  // Get current faction name
  const currentPosition = positions.find((p) => p.IsCurrent && p.FactionID)
  let factionName: string | null = null
  if (currentPosition?.FactionID) {
    try {
      const factions = await odata<KNS_Faction>(
        `KNS_Faction?$filter=FactionID%20eq%20${currentPosition.FactionID}&$top=1&$format=json`
      )
      factionName = factions[0]?.Name ?? null
    } catch {
      // faction lookup is non-critical
    }
  }

  return {
    knsId,
    siteId: siteId ?? 0,
    name: `${person.FirstName} ${person.LastName}`.trim(),
    email: person.Email ?? null,
    faction: factionName,
    isCurrent: person.IsCurrent,
    positions: positions.map((p) => ({
      positionId: p.PositionID,
      isCurrent: p.IsCurrent,
      startDate: p.StartDate,
    })),
  }
}
