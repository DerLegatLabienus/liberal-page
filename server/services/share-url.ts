import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { getShareConfig, isShareConfigured } from './share-config'

const flagsRepo = new FeatureFlagsRepository()

/**
 * Build a resolver for a letter's public share-page URL.
 *
 * A share page only exists when all three hold:
 *  - R2 is configured (credentials + a public base URL),
 *  - the `publicSharePages` flag is on — `syncShareForLetter` no-ops when it's off, so no R2
 *    object is ever written and a link would 404,
 *  - the letter is published.
 *
 * The config and the flag are resolved ONCE here, not per letter; the flag costs a DB round-trip
 * so it's only read when R2 is configured at all. Call this once per request, then apply the
 * returned function to each letter.
 */
export async function makeShareUrlResolver(): Promise<(letter: { status: string; shareSlug: string }) => string | null> {
  const shareBase = isShareConfigured() ? getShareConfig().publicBaseUrl : ''
  const sharePagesEnabled = shareBase ? await flagsRepo.isEnabled('publicSharePages') : false
  return (letter) =>
    shareBase && sharePagesEnabled && letter.status === 'published'
      ? `${shareBase}/letter/${letter.shareSlug}.html`
      : null
}
