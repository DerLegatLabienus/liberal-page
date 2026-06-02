import { odataGet } from './odata'

export interface CommitteeInfo {
  CommitteeID: number
  Name: string
  KnessetNum: number
  CommitteeTypeDesc: string
  Email: string | null
}

export interface CommitteeSessionRow {
  CommitteeSessionID: number
  StartDate: string
  StatusDesc: string
  TypeDesc: string
  SessionUrl: string
}

/**
 * Fetches a committee's info plus its 5 most recent sessions from Knesset OData.
 * Returns null when the committee is not found. HTML rendering stays in the route.
 */
export async function fetchCommitteeDetail(
  committeeId: number,
): Promise<{ committee: CommitteeInfo; sessions: CommitteeSessionRow[] } | null> {
  const [committees, sessions] = await Promise.all([
    odataGet<CommitteeInfo>(`KNS_Committee?$filter=CommitteeID%20eq%20${committeeId}&$format=json`),
    odataGet<CommitteeSessionRow>(
      `KNS_CommitteeSession?$filter=CommitteeID%20eq%20${committeeId}&$orderby=StartDate%20desc&$top=5&$select=CommitteeSessionID,StartDate,StatusDesc,TypeDesc,SessionUrl&$format=json`
    ),
  ])

  const committee = committees[0]
  if (!committee) return null
  return { committee, sessions }
}
