import { MkListRepository } from '../repositories/mk-list-repository'
import { fetchMkImageUrl } from './knesset-scraper'

const mkListRepo = new MkListRepository()

/**
 * Resolve an MK's photo URL from its Knesset Site ID.
 *
 * Prefer the live Knesset header API (`GetMkdetailsHeader.MkImage`), the current source of truth
 * for MK face photos. Fall back to the cached member's photo (which the MK-cache refresh populates
 * from the same API) if the live call fails, else null — never the old `mk_{siteId}.jpg` pattern,
 * which the Knesset removed and now 404s.
 */
export async function resolveMkPhotoUrl(siteId: number): Promise<string | null> {
  const live = await fetchMkImageUrl(siteId)
  if (live) return live
  const mk = await mkListRepo.getBySiteId(siteId)
  return mk?.photoUrl ?? null
}
