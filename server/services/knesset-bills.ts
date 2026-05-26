import { readFile } from 'fs/promises'
import path from 'path'
import type { BillsFeatureFlags, KnessetBillOverviewItem, TrendingBillEntry } from '../../src/types'
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

// The Knesset OData server rejects filters with 3+ substringof clauses (HTTP 473),
// so keywords are queried in pairs and the results merged.
const POLICY_KEYWORD_BATCH = 2

export async function fetchPolicyAlignedBills(limit: number): Promise<KnessetBillOverviewItem[]> {
  const k = getCurrentKnesset()
  const batches: string[][] = []
  for (let i = 0; i < LIBERAL_KEYWORDS.length; i += POLICY_KEYWORD_BATCH) {
    batches.push(LIBERAL_KEYWORDS.slice(i, i + POLICY_KEYWORD_BATCH))
  }
  const results = await Promise.all(
    batches.map((kws) => {
      const ors = kws.map((kw) => `substringof('${kw}',Name)`).join(' or ')
      const filter = `KnessetNum eq ${k} and (${ors})`
      const path =
        `KNS_Bill?$filter=${encodeURIComponent(filter)}` +
        `&$orderby=${encodeURIComponent('BillID desc')}&$top=${limit}` +
        `&$select=${SELECT}&$format=json`
      return cachedQuery(`policy:${k}:${limit}:${kws.join(',')}`, path)
    }),
  )
  const byId = new Map<number, KnessetBillOverviewItem>()
  for (const batch of results) for (const item of batch) byId.set(item.billId, item)
  return [...byId.values()].sort((a, b) => b.billId - a.billId).slice(0, limit)
}

const DATA_DIR = path.join(process.cwd(), 'src/data')

export async function getBillsFlags(): Promise<BillsFeatureFlags> {
  const raw = await readFile(path.join(DATA_DIR, 'feature-flags.json'), 'utf-8')
  return (JSON.parse(raw) as { bills: BillsFeatureFlags }).bills
}

async function fetchBillsByIds(ids: number[]): Promise<Map<number, KnessetBillOverviewItem>> {
  if (ids.length === 0) return new Map()
  const ors = ids.map((id) => `BillID eq ${id}`).join(' or ')
  const odataPath = `KNS_Bill?$filter=${encodeURIComponent(ors)}&$top=${ids.length}&$select=${SELECT}&$format=json`
  const res = await fetch(`${ODATA_BASE}/${odataPath}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OData error ${res.status}`)
  const data = (await res.json()) as { value: RawBill[] }
  const mapped = await mapRows(data.value ?? [])
  return new Map(mapped.map((b) => [b.billId, b]))
}

// Phase 1: only the 'manual' trending algorithm is implemented (curated list).
export async function getTrendingBills(): Promise<KnessetBillOverviewItem[]> {
  const raw = await readFile(path.join(DATA_DIR, 'trending-bills.json'), 'utf-8')
  const entries = (JSON.parse(raw) as { bills: TrendingBillEntry[] }).bills
  const live = await fetchBillsByIds(entries.map((e) => e.billId))
  return entries.map((e) => {
    const hydrated = live.get(e.billId)
    return hydrated
      ? { ...hydrated, reason: e.reason }
      : {
          billId: e.billId,
          title: e.title,
          statusId: 0,
          status: '',
          committee: '',
          lastUpdatedDate: '',
          summary: '',
          knessetUrl: knessetUrl(e.billId),
          reason: e.reason,
        }
  })
}
