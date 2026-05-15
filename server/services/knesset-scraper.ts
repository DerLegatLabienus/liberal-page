import type { MkActivity } from '../../src/types'

const KNESSET_ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

interface KNS_BillInitiatorRecord {
  BillInitiatorID: number
  BillID: number
  PersonID: number
  LastUpdatedDate: string
  KNS_Bill: {
    BillID: number
    Name: string
    SubTypeDesc: string | null
    KnessetNum: number
  }
}

interface KNS_QueryRecord {
  QueryID: number
  Name: string
  TypeDesc: string | null
  SubmitDate: string
}

async function fetchJson<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Knesset OData error ${res.status}`)
  const data = await res.json() as { value?: T[] }
  return data.value ?? []
}

async function fetchMkBills(knsId: number): Promise<MkActivity[]> {
  const url =
    `${KNESSET_ODATA_BASE}/KNS_BillInitiator` +
    `?$filter=PersonID%20eq%20${knsId}` +
    `&$expand=KNS_Bill` +
    `&$orderby=LastUpdatedDate%20desc` +
    // Fetch extra bills to buffer for the interleaved sort with questions,
    // so the final merged slice of `limit` (default 10) is well-populated.
    `&$top=20` +
    `&$format=json`

  const records = await fetchJson<KNS_BillInitiatorRecord>(url)
  return records
    .filter((r) => r.KNS_Bill?.Name)
    .map((r) => ({
      type: 'bill_initiated' as const,
      date: r.LastUpdatedDate,
      title: r.KNS_Bill.Name,
      detail: r.KNS_Bill.SubTypeDesc ?? undefined,
      sourceUrl:
        `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx` +
        `?t=lawsuggestionssearch&lawitemid=${r.BillID}`,
    }))
}

async function fetchMkQuestions(knsId: number): Promise<MkActivity[]> {
  const url =
    `${KNESSET_ODATA_BASE}/KNS_Query` +
    `?$filter=PersonID%20eq%20${knsId}` +
    `&$orderby=SubmitDate%20desc` +
    `&$top=10` +
    `&$format=json`

  const records = await fetchJson<KNS_QueryRecord>(url)
  return records
    .filter((r) => r.Name)
    .map((r) => ({
      type: 'question' as const,
      date: r.SubmitDate,
      title: r.Name,
      detail: r.TypeDesc ?? undefined,
      sourceUrl:
        `https://main.knesset.gov.il/Activity/Legislation/Questions/Pages/QueryDetails.aspx` +
        `?QueryId=${r.QueryID}`,
    }))
}

/**
 * Fetch MK activity (bills initiated + parliamentary questions)
 * from Knesset OData, merged and sorted newest first.
 *
 * @param knsId  Internal Knesset PersonID (KnsID)
 * @param limit  Max items to return (default 10)
 */
export async function fetchMkActivity(knsId: number, limit = 10): Promise<MkActivity[]> {
  const [billsResult, questionsResult] = await Promise.allSettled([
    fetchMkBills(knsId),
    fetchMkQuestions(knsId),
  ])

  const bills = billsResult.status === 'fulfilled' ? billsResult.value : []
  const questions = questionsResult.status === 'fulfilled' ? questionsResult.value : []

  return [...bills, ...questions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}
