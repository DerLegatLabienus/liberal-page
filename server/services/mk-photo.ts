import { MkListRepository } from '../repositories/mk-list-repository'

const mkListRepo = new MkListRepository()

/**
 * Resolve an MK's photo URL from its Knesset Site ID.
 *
 * Prefer the cached member's photo (populated by knesset-members.ts, which itself prefers the
 * OData PictureDeputyUrl), so a member whose image isn't the default pattern still resolves
 * correctly. Fall back to the deterministic Knesset image path for a Site ID that isn't in the
 * cache (e.g. a former MK), which the Knesset site serves by Site ID.
 */
export async function resolveMkPhotoUrl(siteId: number): Promise<string> {
  const mk = await mkListRepo.getBySiteId(siteId)
  return mk?.photoUrl ?? `https://www.knesset.gov.il/mk/images/members/mk_${siteId}.jpg`
}
