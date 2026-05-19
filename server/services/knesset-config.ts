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

async function markInactiveMks(newKnesset: number): Promise<void> {
  const [personsRes, siteCodesRes] = await Promise.all([
    fetch(`${ODATA_BASE}/KNS_Person?$filter=IsCurrent%20eq%20true&$select=PersonID&$top=200&$format=json`,
      { headers: { Accept: 'application/json' } }),
    fetch(`${ODATA_BASE}/KNS_MkSiteCode?$filter=KnessetNum%20eq%20${newKnesset}&$select=KnsID,SiteId&$top=200&$format=json`,
      { headers: { Accept: 'application/json' } }),
  ])
  const persons = personsRes.ok ? (await personsRes.json() as { value: Array<{ PersonID: number }> }).value : []
  const siteCodes = siteCodesRes.ok ? (await siteCodesRes.json() as { value: Array<{ KnsID: number; SiteId: number }> }).value : []

  const activePersonIds = new Set(persons.map((p) => p.PersonID))
  const activeSiteIds = new Set(
    siteCodes.filter((sc) => activePersonIds.has(sc.KnsID)).map((sc) => String(sc.SiteId))
  )

  let mks: Array<Record<string, unknown>> = []
  try {
    mks = JSON.parse(await readFile(MKS_PATH, 'utf-8') as string) as Array<Record<string, unknown>>
  } catch { return }

  let changed = false
  for (const mk of mks) {
    const siteId = mk.knesset_site_id as string | undefined
    if (siteId && !activeSiteIds.has(siteId) && !mk.inactive) {
      mk.inactive = true
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
