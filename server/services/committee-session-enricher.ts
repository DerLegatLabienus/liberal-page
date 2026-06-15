import type { CommitteeSession } from '../../src/types'
import { odataGet } from './odata'

interface ODataSession {
  CommitteeSessionID: number
  StartDate: string
  KnessetNum: number
  SessionUrl: string
}

interface ODataItem { Name: string; Ordinal: number }
interface ODataCommittee { CommitteeID: number; Name: string; KnessetNum: number }

// Enrichment is best-effort: a failed call yields no sessions rather than an error,
// so it never blocks tracking. Wrap the throwing shared helper to preserve that.
async function safeOdataGet<T>(path: string): Promise<T[]> {
  try {
    return await odataGet<T>(path)
  } catch {
    return []
  }
}

async function resolveCommitteeId(committeeName: string): Promise<number | null> {
  const encoded = encodeURIComponent(committeeName.trim())
  // Resolve to the NEWEST committee instance with this name. We deliberately do NOT filter on
  // IsCurrent: the Knesset OData sets IsCurrent=true on multiple historical instances of the
  // same-named committee (e.g. "ועדת הכלכלה" is true for both Knesset 15 / CommitteeID 4 and
  // Knesset 25 / CommitteeID 4193). Ordering by KnessetNum desc + top 1 always picks the
  // current term's committee, whose sessions are the recent ones.
  const results = await safeOdataGet<ODataCommittee>(
    `KNS_Committee?$filter=Name%20eq%20'${encoded}'&$orderby=KnessetNum%20desc&$select=CommitteeID,Name,KnessetNum&$top=1&$format=json`
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

    const sessions = await safeOdataGet<ODataSession>(
      `KNS_CommitteeSession?$filter=CommitteeID%20eq%20${committeeId}&$orderby=StartDate%20desc&$top=5&$select=CommitteeSessionID,StartDate,KnessetNum,SessionUrl&$format=json`
    )
    if (!sessions.length) return []

    const results: CommitteeSession[] = []
    for (const session of sessions) {
      const items = await safeOdataGet<ODataItem>(
        `KNS_CmtSessionItem?$filter=CommitteeSessionID%20eq%20${session.CommitteeSessionID}&$select=Name,Ordinal&$orderby=Ordinal&$top=5&$format=json`
      )
      const title = items.map(i => i.Name).filter(Boolean).join(' · ').slice(0, 120)

      const sessionUrl = session.SessionUrl.replace('http://', 'https://')

      results.push({
        sessionId: session.CommitteeSessionID,
        date: session.StartDate,
        knessetNum: session.KnessetNum,
        title,
        sessionUrl,
        attendingSiteIds: [],
      })
    }
    return results
  } catch {
    return []
  }
}
