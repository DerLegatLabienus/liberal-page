import type { MkActivity } from '../../src/types'

const KNESSET_WEBSITE_API = 'https://www.knesset.gov.il/WebSiteApi/knessetapi'
const CURRENT_KNESSET = 25

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

function parsePlenaryDate(s: string): string {
  // "13/05/2026, בשעה 11:42" → "2026-05-13T11:42:00"
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})(?:.*?(\d{2}):(\d{2}))?/)
  if (!m) return new Date().toISOString()
  const [, d, mo, y, h = '00', mi = '00'] = m
  return `${y}-${mo}-${d}T${h}:${mi}:00`
}

export async function fetchMkActivity(siteId: number, limit = 10): Promise<MkActivity[]> {
  const url = `${KNESSET_WEBSITE_API}/MKs/GetParlamentayActivity?mkId=${siteId}&knessetId=${CURRENT_KNESSET}`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Referer: 'https://main.knesset.gov.il/' },
  })
  if (!res.ok) throw new Error(`Knesset Website API error ${res.status}`)
  const data = await res.json() as KnessetActivityResponse

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
