import { readFileSync } from 'fs'
import type { CommitteeListItem } from '../../src/types'
import { CommitteeListRepository } from '../repositories/committee-list-repository'
import { CommitteesRepository } from '../repositories/committees-repository'
import { getCurrentKnesset } from './knesset-config'
import { odataGetAllPages } from './odata'

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour - ensures mapping changes propagate quickly

// Local mapping: CommitteeID → apps URL ID (CategoryID-based, with manual overrides).
// Update src/data/committee-url-mapping.json to add/fix IDs when needed.
let urlMapping: Record<string, number> = {}
try {
  const mappingPath = `${process.cwd()}/src/data/committee-url-mapping.json`
  urlMapping = JSON.parse(readFileSync(mappingPath, 'utf-8'))
} catch { /* mapping unavailable, use empty */ }

const listRepo = new CommitteeListRepository()
const committeesRepo = new CommitteesRepository()

/**
 * Returns the cached active-committee list, refreshing from Knesset OData when stale.
 * On a successful refresh, reconciles tracked committees' inactive flags against the
 * fresh active id list (closure detection). Called by the /list route and the poller.
 */
export async function refreshCommitteeListIfStale(): Promise<CommitteeListItem[]> {
  const cached = await listRepo.get()
  if (cached && listRepo.getAgeMs() < CACHE_TTL_MS) return cached

  const raw = await odataGetAllPages<{ CommitteeID: number; Name: string }>(
    `KNS_Committee?$filter=IsCurrent%20eq%20true%20and%20KnessetNum%20eq%20${getCurrentKnesset()}&$select=CommitteeID,Name&$top=200&$format=json`
  )

  const committees: CommitteeListItem[] = raw.map((c) => {
    const appsId = urlMapping[String(c.CommitteeID)]
    return {
      committeeId: c.CommitteeID,
      name: c.Name.trim(),
      knessetUrl: appsId ? `https://main.knesset.gov.il/apps/committees/${appsId}` : '',
    }
  })

  await listRepo.set(committees)

  const { deactivated, reactivated } = await committeesRepo.reconcileActiveStatus(
    committees.map((c) => c.committeeId),
  )
  if (deactivated || reactivated) {
    console.log(`Committee status reconciled: ${deactivated} closed, ${reactivated} reopened`)
  }

  return committees
}
