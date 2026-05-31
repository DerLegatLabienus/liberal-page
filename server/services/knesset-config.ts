import { KnessetConfigRepository } from '../repositories/knesset-config-repository'
import { MkListRepository } from '../repositories/mk-list-repository'
import { CommitteeListRepository } from '../repositories/committee-list-repository'

const ODATA_BASE = 'https://knesset.gov.il/Odata/ParliamentInfo.svc'

interface KnessetConfig {
  currentKnesset: number
  detectedAt: string
}

const configRepo = new KnessetConfigRepository()
let config: KnessetConfig = { currentKnesset: 25, detectedAt: new Date().toISOString() }

export async function loadConfig(): Promise<void> {
  const stored = await configRepo.get()
  if (stored) config = stored
}

export function getCurrentKnesset(): number {
  return config.currentKnesset
}

export async function runTransition(newKnesset: number): Promise<void> {
  const current = config.currentKnesset
  console.log(`Knesset transition: ${current} → ${newKnesset}`)

  // Persist the new Knesset number and update the in-memory config
  await configRepo.set(newKnesset)
  config = { currentKnesset: newKnesset, detectedAt: new Date().toISOString() }

  // Invalidate the member/committee list caches so they are re-fetched
  await new MkListRepository().clear()
  await new CommitteeListRepository().clear()
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
