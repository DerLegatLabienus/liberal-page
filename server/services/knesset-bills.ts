import type { KnessetBillOverviewItem } from '../../src/types'
import { getBillStatusMap } from './bill-status-map'
import { getCurrentKnesset } from './knesset-config'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'
const TTL_MS = 5 * 60 * 1000

function knessetUrl(billId: number): string {
  return `https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?t=lawsuggestionssearch&lawitemid=${billId}`
}

interface RawBill {
  BillID: number
  Name: string
  StatusID: number
  CommitteeID: number | null
  LastUpdatedDate: string
  SummaryLaw: string | null
}

async function mapRows(rows: RawBill[]): Promise<KnessetBillOverviewItem[]> {
  const statusMap = await getBillStatusMap()
  return rows.map((r) => ({
    billId: r.BillID,
    title: r.Name.trim(),
    statusId: r.StatusID,
    status: statusMap.get(r.StatusID) ?? '',
    committee: '', // Phase 1: committee name not resolved
    lastUpdatedDate: r.LastUpdatedDate ?? '',
    summary: (r.SummaryLaw ?? '').trim(),
    knessetUrl: knessetUrl(r.BillID),
  }))
}

const cache = new Map<string, { items: KnessetBillOverviewItem[]; at: number }>()

export function _resetBillsCache() {
  cache.clear()
}

async function cachedQuery(key: string, odataPath: string): Promise<KnessetBillOverviewItem[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items

  const res = await fetch(`${ODATA_BASE}/${odataPath}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OData error ${res.status}`)
  const data = (await res.json()) as { value: RawBill[] }
  const items = await mapRows(data.value ?? [])
  cache.set(key, { items, at: Date.now() })
  return items
}

const SELECT = 'BillID,Name,StatusID,CommitteeID,LastUpdatedDate,SummaryLaw'

export async function fetchRecentBills(limit: number): Promise<KnessetBillOverviewItem[]> {
  const k = getCurrentKnesset()
  const path = `KNS_Bill?$filter=KnessetNum%20eq%20${k}&$orderby=BillID%20desc&$top=${limit}&$select=${SELECT}&$format=json`
  return cachedQuery(`recent:${k}:${limit}`, path)
}

export const LIBERAL_KEYWORDS = ['חירות', 'שוק חופשי', 'זכויות', 'תחרות', 'רגולציה', 'קניין']

export async function fetchPolicyAlignedBills(limit: number): Promise<KnessetBillOverviewItem[]> {
  const k = getCurrentKnesset()
  const ors = LIBERAL_KEYWORDS.map((kw) => `substringof('${kw}',Name)`).join(' or ')
  const filter = `KnessetNum eq ${k} and (${ors})`
  const path =
    `KNS_Bill?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=${encodeURIComponent('BillID desc')}&$top=${limit}` +
    `&$select=${SELECT}&$format=json`
  return cachedQuery(`policy:${k}:${limit}`, path)
}
