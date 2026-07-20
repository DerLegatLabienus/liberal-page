import type { MkActivity } from '../../src/types'
import { fetchWithTimeout } from '../lib/http'

const KNESSET_WEBSITE_API = 'https://www.knesset.gov.il/WebSiteApi/knessetapi'
import { getCurrentKnesset } from './knesset-config'

interface KnessetActivityResponse {
  PrivateBills: Array<{
    Date: string
    InitiatiorType: string
    Name: string
    BillLink: string
  }>
  PlenaryVotes: Array<{
    Date: string
    VoteResult: string
    Name: string
    VoteID: number
  }>
  Queries: Array<{
    ID: number
    Date: string
    QueryType: string
    Subject: string
  }>
  AgendaProposals: unknown[]
}

interface MkHeaderResponse {
  MkImage?: string | null
  LobbyImage?: string | null
  Email?: string | null
}

const absoluteUrl = (s: string | null | undefined): string | null => {
  const v = s?.trim()
  return v && /^https?:\/\//i.test(v) ? v : null
}

async function fetchMkHeader(siteId: number): Promise<MkHeaderResponse | null> {
  const url = `${KNESSET_WEBSITE_API}/MKs/GetMkdetailsHeader?mkId=${siteId}&languageKey=he`
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json', Referer: 'https://main.knesset.gov.il/' },
    })
    if (!res.ok) return null
    // A 200 can still be an HTML bot/maintenance page; parsing it as JSON throws → caught below.
    return (await res.json()) as MkHeaderResponse
  } catch {
    return null
  }
}

/**
 * The MK's official `@knesset.gov.il` email from the live Knesset header API, or null.
 * Norwegian-Law ministers (who resigned their seat) return an empty email — treated as null.
 */
export async function fetchMkEmail(siteId: number): Promise<string | null> {
  const email = (await fetchMkHeader(siteId))?.Email?.trim()
  return email || null
}

/**
 * The MK's face-photo URL from the live Knesset header API, or null if unavailable.
 *
 * The Knesset removed `PictureDeputyUrl` from OData, so the old deterministic
 * `mk_{siteId}.jpg` pattern is now a hard 404. `GetMkdetailsHeader.MkImage` is the current
 * source — a full `fs.knesset.gov.il/globaldocs/...` URL whose per-MK doc id isn't derivable.
 * Ministers who resigned their seat (Norwegian Law, `IsCurrentMk: false`) have a null `MkImage`
 * but still carry the same photo under `LobbyImage`, so fall back to that.
 */
export async function fetchMkImageUrl(siteId: number): Promise<string | null> {
  const data = await fetchMkHeader(siteId)
  if (!data) return null
  return absoluteUrl(data.MkImage) ?? absoluteUrl(data.LobbyImage)
}

function parsePlenaryDate(s: string): string {
  // "13/05/2026, בשעה 11:42" → "2026-05-13T11:42:00"
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})(?:.*?(\d{2}):(\d{2}))?/)
  if (!m) return new Date().toISOString()
  const [, d, mo, y, h = '00', mi = '00'] = m
  return `${y}-${mo}-${d}T${h}:${mi}:00`
}

export async function fetchMkActivity(siteId: number, limit = 10): Promise<MkActivity[]> {
  const url = `${KNESSET_WEBSITE_API}/MKs/GetParlamentayActivity?mkId=${siteId}&knessetId=${getCurrentKnesset()}`
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json', Referer: 'https://main.knesset.gov.il/' },
  })
  if (!res.ok) throw new Error(`Knesset Website API error ${res.status}`)
  // The Knesset site can answer 200 with an HTML bot/maintenance page; parsing that as
  // JSON would throw "Unexpected token '<'". Treat a non-JSON body as "no activity".
  let data: KnessetActivityResponse
  try {
    data = await res.json() as KnessetActivityResponse
  } catch {
    console.warn(`Knesset Website API returned non-JSON for MK ${siteId}; skipping this cycle`)
    return []
  }

  const bills: MkActivity[] = (data.PrivateBills ?? []).map((b) => ({
    type: 'bill_initiated' as const,
    date: b.Date,
    title: b.Name,
    sourceUrl: `https://main.knesset.gov.il${b.BillLink}`,
  }))

  const votes: MkActivity[] = (data.PlenaryVotes ?? []).map((v) => ({
    type: 'vote' as const,
    date: parsePlenaryDate(v.Date),
    title: v.Name,
    detail: v.VoteResult,
    sourceUrl: `https://main.knesset.gov.il/Activity/plenum/Pages/VotingRecord.aspx?VoteId=${v.VoteID}`,
  }))

  const seen = new Set<number>()
  const questions: MkActivity[] = (data.Queries ?? [])
    .filter((q) => { if (seen.has(q.ID)) return false; seen.add(q.ID); return true })
    .map((q) => ({
      type: 'question' as const,
      date: q.Date,
      title: q.Subject,
      detail: q.QueryType,
      sourceUrl: `https://main.knesset.gov.il/Activity/Legislation/Questions/Pages/QueryDetails.aspx?QueryId=${q.ID}`,
    }))

  return [...bills, ...votes, ...questions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}
