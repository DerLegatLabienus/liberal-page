import { readFile } from 'fs/promises'
import path from 'path'
import type { KnessetBillOverviewItem, TrendingBillEntry, BillSearchResult } from '../../src/types'
import { getBillStatusMap } from './bill-status-map'
import { getCurrentKnesset } from './knesset-config'
import { CommitteeListRepository } from '../repositories/committee-list-repository'
import { odataGet, odataGetAllPages } from './odata'

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
  const [statusMap, committeeMap] = await Promise.all([getBillStatusMap(), getCommitteeNameMap()])
  return rows.map((r) => ({
    billId: r.BillID,
    title: r.Name.trim(),
    statusId: r.StatusID,
    status: statusMap.get(r.StatusID) ?? '',
    committee: r.CommitteeID ? (committeeMap.get(r.CommitteeID) ?? '') : '',
    lastUpdatedDate: r.LastUpdatedDate ?? '',
    summary: (r.SummaryLaw ?? '').trim(),
    knessetUrl: knessetUrl(r.BillID),
  }))
}

const cache = new Map<string, { items: KnessetBillOverviewItem[]; at: number }>()
let committeeMapCache: { map: Map<number, string>; at: number } | null = null
const COMMITTEE_MAP_TTL = 5 * 60 * 1000

export function _resetBillsCache() {
  cache.clear()
}

export function _resetCommitteeMapCache() {
  committeeMapCache = null
}

// --- Progress ranking cache (maps billId → max CommitteeSessionID seen) ---
const PROGRESS_POOL = 200
const PROGRESS_TTL = 30 * 60 * 1000

interface ProgressCache { map: Map<number, number>; at: number; knesset: number }
let progressCache: ProgressCache | null = null

export function _resetProgressCache() { progressCache = null }

async function getProgressScoreMap(knesset: number, billIds: number[]): Promise<Map<number, number>> {
  if (progressCache && progressCache.knesset === knesset && Date.now() - progressCache.at < PROGRESS_TTL) {
    return progressCache.map
  }
  const ors = billIds.map((id) => `ItemID eq ${id}`).join(' or ')
  const path =
    `KNS_CmtSessionItem?$filter=ItemTypeID eq 2 and (${ors})` +
    `&$select=ItemID,CommitteeSessionID&$format=json`
  const rows = await odataGetAllPages<{ ItemID: number; CommitteeSessionID: number }>(path)
  const map = new Map<number, number>()
  for (const row of rows) {
    const prev = map.get(row.ItemID) ?? 0
    if (row.CommitteeSessionID > prev) map.set(row.ItemID, row.CommitteeSessionID)
  }
  progressCache = { map, at: Date.now(), knesset }
  return map
}

const committeeListRepo = new CommitteeListRepository()

async function getCommitteeNameMap(): Promise<Map<number, string>> {
  if (committeeMapCache && Date.now() - committeeMapCache.at < COMMITTEE_MAP_TTL) {
    return committeeMapCache.map
  }
  try {
    const committees = await committeeListRepo.get()
    if (!committees) return new Map()
    const map = new Map(committees.map((c) => [c.committeeId, c.name]))
    committeeMapCache = { map, at: Date.now() }
    return map
  } catch {
    return new Map()
  }
}

async function cachedQuery(key: string, odataPath: string): Promise<KnessetBillOverviewItem[]> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items

  const rows = await odataGet<RawBill>(odataPath)
  const items = await mapRows(rows)
  cache.set(key, { items, at: Date.now() })
  return items
}

const SELECT = 'BillID,Name,StatusID,CommitteeID,LastUpdatedDate,SummaryLaw'

/** Current (Hebrew) status for a bill by its Knesset BillID, or null if not found. */
export async function fetchBillStatusById(billId: number): Promise<string | null> {
  const path = `KNS_Bill?$filter=BillID%20eq%20${billId}&$top=1&$select=${SELECT}&$format=json`
  const rows = await odataGet<RawBill>(path)
  if (!rows.length) return null
  const [item] = await mapRows(rows)
  return item.status || null
}

/** Free-text bill search by name within a Knesset. Returns lightweight search results. */
export async function searchBills(query: string, knesset: number): Promise<BillSearchResult[]> {
  const encoded = encodeURIComponent(query)
  const path = `KNS_Bill?$filter=KnessetNum%20eq%20${knesset}%20and%20substringof('${encoded}',Name)&$top=20&$select=BillID,Name,StatusID&$format=json`
  const rows = await odataGet<{ BillID: number; Name: string; StatusID: number }>(path)
  return rows.map((b) => ({
    billId: b.BillID,
    name: b.Name.trim(),
    knessetUrl: knessetUrl(b.BillID),
  }))
}

export async function fetchRecentBills(limit: number, ranking = 'newest'): Promise<KnessetBillOverviewItem[]> {
  const k = getCurrentKnesset()
  if (ranking === 'progress') {
    const poolPath = `KNS_Bill?$filter=KnessetNum%20eq%20${k}&$orderby=BillID%20desc&$top=${PROGRESS_POOL}&$select=${SELECT}&$format=json`
    const pool = await cachedQuery(`recent:${k}:${PROGRESS_POOL}`, poolPath)
    const scoreMap = await getProgressScoreMap(k, pool.map((b) => b.billId))
    return [...pool]
      .sort((a, b) => (scoreMap.get(b.billId) ?? 0) - (scoreMap.get(a.billId) ?? 0))
      .slice(0, limit)
  }
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

/** Public bill page URL for a Knesset BillID (a bill's oknesset_id is a BillID). */
export function knessetBillUrl(billId: number): string {
  return knessetUrl(billId)
}

const DATA_DIR = path.join(process.cwd(), 'src/data')

async function fetchBillsByIds(ids: number[]): Promise<Map<number, KnessetBillOverviewItem>> {
  if (ids.length === 0) return new Map()
  const ors = ids.map((id) => `BillID eq ${id}`).join(' or ')
  const odataPath = `KNS_Bill?$filter=${encodeURIComponent(ors)}&$top=${ids.length}&$select=${SELECT}&$format=json`
  const rows = await odataGet<RawBill>(odataPath)
  const mapped = await mapRows(rows)
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
