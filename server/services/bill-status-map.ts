import { odataGet } from './odata'

const TTL_MS = 24 * 60 * 60 * 1000 // statuses are near-static; refresh daily

let cache: { map: Map<number, string>; at: number } | null = null

export function _resetStatusMapCache() {
  cache = null
}

export async function getBillStatusMap(): Promise<Map<number, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map

  try {
    const rows = await odataGet<{ StatusID: number; Desc: string }>(
      'KNS_Status?$filter=TypeID%20eq%202&$select=StatusID,Desc&$format=json'
    )
    const map = new Map<number, string>()
    for (const row of rows) map.set(row.StatusID, row.Desc)
    cache = { map, at: Date.now() }
    return map
  } catch {
    // Don't poison the cache on failure; return empty so callers fall back to ''
    return new Map()
  }
}
