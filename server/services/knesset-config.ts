import { readFileSync } from 'fs'
import { readFile, writeFile, unlink } from 'fs/promises'
import path from 'path'

const CONFIG_PATH = path.join(process.cwd(), 'src/data/knesset-config.json')
const MKS_PATH = path.join(process.cwd(), 'src/data/mks.json')
const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

interface KnessetConfig {
  currentKnesset: number
  detectedAt: string
}

function loadConfig(): KnessetConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as KnessetConfig
  } catch {
    return { currentKnesset: 25, detectedAt: new Date().toISOString() }
  }
}

let config = loadConfig()

export function getCurrentKnesset(): number {
  return config.currentKnesset
}

async function markInactiveMks(_newKnesset: number): Promise<void> {
  // Get all currently active MK PersonIDs from OData (paginated — there are ~138 current MKs)
  const allPersons: Array<{ PersonID: number }> = []
  let nextPath: string | null = `KNS_Person?$filter=IsCurrent%20eq%20true&$select=PersonID&$top=200&$format=json`
  while (nextPath) {
    const res = await fetch(`${ODATA_BASE}/${nextPath}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) break
    const data = await res.json() as { value: Array<{ PersonID: number }>; 'odata.nextLink'?: string }
    allPersons.push(...(data.value ?? []))
    nextPath = data['odata.nextLink'] ?? null
  }
  const activePersonIds = new Set(allPersons.map((p) => p.PersonID))

  // For each tracked MK, resolve their SiteId → PersonID via KNS_MkSiteCode (no KnessetNum filter)
  // KNS_MkSiteCode.KnessetNum doesn't exist in OData — filter by SiteId directly
  let mks: Array<Record<string, unknown>> = []
  try {
    mks = JSON.parse(await readFile(MKS_PATH, 'utf-8') as string) as Array<Record<string, unknown>>
  } catch { return }

  const trackedSiteIds = mks.map((mk) => mk.knesset_site_id as string).filter(Boolean)
  const siteCodeBatches = await Promise.all(
    trackedSiteIds.map((siteId) =>
      fetch(`${ODATA_BASE}/KNS_MkSiteCode?$filter=SiteId%20eq%20${siteId}&$select=KnsID,SiteId&$top=1&$format=json`,
        { headers: { Accept: 'application/json' } })
        .then((r) => r.ok ? r.json() as Promise<{ value: Array<{ KnsID: number; SiteId: number }> }> : { value: [] })
        .then((d) => d.value[0] ?? null)
        .catch(() => null)
    )
  )
  const activeSiteIds = new Set(
    siteCodeBatches
      .filter((sc): sc is { KnsID: number; SiteId: number } => sc !== null && activePersonIds.has(sc.KnsID))
      .map((sc) => String(sc.SiteId))
  )

  let changed = false
  for (const mk of mks) {
    const siteId = mk.knesset_site_id as string | undefined
    if (!siteId) continue
    if (!activeSiteIds.has(siteId) && !mk.inactive) {
      mk.inactive = true
      changed = true
    } else if (activeSiteIds.has(siteId) && mk.inactive) {
      // MK is active in the new Knesset — clear inactive flag
      mk.inactive = false
      changed = true
    }
  }

  if (changed) {
    await writeFile(MKS_PATH, JSON.stringify(mks, null, 2), 'utf-8')
  }
}

export async function runTransition(newKnesset: number): Promise<void> {
  const current = config.currentKnesset
  console.log(`Knesset transition: ${current} → ${newKnesset}`)

  config = { currentKnesset: newKnesset, detectedAt: new Date().toISOString() }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')

  const caches = [
    path.join(process.cwd(), 'src/data/knesset-members-cache.json'),
    path.join(process.cwd(), 'src/data/knesset-committees-cache.json'),
  ]
  await Promise.all(caches.map((p) => unlink(p).catch(() => { /* already absent */ })))

  await markInactiveMks(newKnesset).catch((err) => {
    console.error('Failed to mark inactive MKs:', err)
  })
}

export async function detectKnessetTransition(): Promise<boolean> {
  try {
    const res = await fetch(
      `${ODATA_BASE}/KNS_PersonToPosition?$filter=PositionID%20eq%2043%20and%20IsCurrent%20eq%20true&$orderby=KnessetNum%20desc&$top=1&$select=KnessetNum&$format=json`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return false
    const data = await res.json() as { value: Array<{ KnessetNum: number }> }
    const liveKnesset = data.value?.[0]?.KnessetNum
    if (!liveKnesset || liveKnesset <= config.currentKnesset) return false
    await runTransition(liveKnesset)
    return true
  } catch {
    return false
  }
}
