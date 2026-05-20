import path from 'path'
import { readFile } from 'fs/promises'
import type { CommitteeSession } from '../../src/types'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const MK_LIST_CACHE = path.join(process.cwd(), 'src/data/knesset-members-cache.json')
const ANNOTATIONS_PATH = path.join(process.cwd(), 'src/data/mk-annotations.json')

interface ODataSession {
  CommitteeSessionID: number
  StartDate: string
  KnessetNum: number
  SessionUrl: string
}

interface ODataItem { Name: string; Ordinal: number }
interface ODataCommittee { CommitteeID: number; Name: string }

async function odataGet<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${ODATA_BASE}/${path}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const data = await res.json() as { value?: T[] }
    return data.value ?? []
  } catch {
    return []
  }
}

async function resolveCommitteeId(committeeName: string): Promise<number | null> {
  const encoded = encodeURIComponent(committeeName.trim())
  const results = await odataGet<ODataCommittee>(
    `KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20KnessetNum%20eq%2025%20and%20Name%20eq%20'${encoded}'&$select=CommitteeID,Name&$top=1&$format=json`
  )
  return results[0]?.CommitteeID ?? null
}

export async function enrichCommitteeSessions(
  committeeName: string,
  _trackedMkSiteIds: string[],
  _aiEnabled: boolean
): Promise<CommitteeSession[]> {
  try {
    const committeeId = await resolveCommitteeId(committeeName)
    if (!committeeId) return []

    const sessions = await odataGet<ODataSession>(
      `KNS_CommitteeSession?$filter=CommitteeID%20eq%20${committeeId}&$orderby=StartDate%20desc&$top=2&$select=CommitteeSessionID,StartDate,KnessetNum,SessionUrl&$format=json`
    )
    if (!sessions.length) return []

    const results: CommitteeSession[] = []
    for (const session of sessions) {
      const items = await odataGet<ODataItem>(
        `KNS_CmtSessionItem?$filter=CommitteeSessionID%20eq%20${session.CommitteeSessionID}&$select=Name,Ordinal&$orderby=Ordinal&$top=5&$format=json`
      )
      const title = items.map(i => i.Name).filter(Boolean).join(' · ').slice(0, 120)

      results.push({
        sessionId: session.CommitteeSessionID,
        date: session.StartDate,
        knessetNum: session.KnessetNum,
        title,
        sessionUrl: session.SessionUrl.replace('http://', 'https://'),
        attendingSiteIds: [],
      })
    }
    return results
  } catch {
    return []
  }
}
