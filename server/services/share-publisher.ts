import { inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { letterContacts } from '../db/schema'
import { LettersRepository, attachChannels } from '../repositories/letters-repository'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { buildChannelSends } from './channel-send'
import { getShareConfig } from './share-config'
import { isConfigured, putObject, deleteObject } from './r2-client'
import { renderShareHtml, renderShareImage, SHARE_RENDERER_VERSION, type ShareLetterView, type ShareChannelBlock } from './share-renderer'

const lettersRepo = new LettersRepository()
const tagsRepo = new LetterIssueTagsRepository()
const flagsRepo = new FeatureFlagsRepository()

// Canonical keys use the letter's opaque slug so shared URLs don't expose the sequential id.
// The id-keyed pair is still written as a legacy mirror so links already circulating keep
// resolving. (Consequence, accepted: the id-keyed pages remain enumerable.)
const htmlKey = (key: string | number) => `letter/${key}.html`
const imageKey = (key: string | number) => `letter/${key}.png`

/** Publish a published letter's share objects, or remove them otherwise. Never throws. */
export async function syncShareForLetter(letterId: number): Promise<void> {
  try {
    if (!isConfigured()) return
    if (!(await flagsRepo.isEnabled('publicSharePages'))) return

    const row = await lettersRepo.getById(letterId)
    if (!row || row.status !== 'published') {
      await removeShareForLetter(letterId)
      return
    }

    // Content lives in letter_channels now (legacy letters.subject/bodyHtml/toAddresses are
    // empty) — assemble the letter with its channels and resolve real send links from them,
    // reusing channel-send.ts so the share page's mailto/gmail/sms/whatsapp links are byte-for-
    // byte identical to what the member detail page produces.
    const [letter] = await attachChannels([row])
    const sends = await buildChannelSends(letter.channels)

    const emailChannel = letter.channels.find((c) => c.kind === 'email' && c.enabled)
    const emailSend = sends.find((s) => s.kind === 'email' && s.enabled)

    // Recipient names for the "אל:" line — resolved directly (not via buildChannelSends,
    // which only returns urls/html for email) since we just need display names here.
    // Filter to only contacts WITH an email (matching the actual send recipients list).
    let emailNames: string[] = []
    if (emailChannel && emailChannel.recipientIds.length) {
      const rows = await db
        .select({ displayName: letterContacts.displayName, email: letterContacts.email })
        .from(letterContacts)
        .where(inArray(letterContacts.id, emailChannel.recipientIds))
      emailNames = rows.filter((r) => r.email).map((r) => r.displayName)
    }

    const channelBlocks: ShareChannelBlock[] = sends
      .filter((s) => s.enabled && (s.kind === 'sms' || s.kind === 'whatsapp'))
      .map((s) => ({
        kind: s.kind as 'sms' | 'whatsapp',
        bodyText: s.bodyText,
        recipients: (s.recipients ?? []).map((r) => ({ contactId: r.contactId, displayName: r.displayName, url: r.url })),
      }))
      .filter((b) => b.recipients.length > 0)

    const channelNames = channelBlocks.flatMap((b) => b.recipients.map((r) => r.displayName))
    const recipientNames = [...new Set([...emailNames, ...channelNames])]

    const allTags = await tagsRepo.list()
    const tagIds = letter.issueTagIds
    const view: ShareLetterView = {
      id: letter.id,
      slug: letter.shareSlug,
      title: letter.title,
      recipientNames,
      issueTags: allTags.filter((t) => tagIds.includes(t.id)).map((t) => t.name),
      // No email channel (or it's disabled) → sms/whatsapp-only letter; the page still
      // renders (title + tags + channel links), it just omits the email block.
      email: emailChannel && emailSend
        ? {
            subject: emailChannel.subject ?? letter.title,
            bodyHtml: emailSend.renderedHtml ?? '',
            bodyPlain: emailSend.bodyText ?? '',
            mailtoUrl: emailSend.mailtoUrl ?? '',
            gmailUrl: emailSend.gmailUrl ?? '',
          }
        : undefined,
      channels: channelBlocks.length ? channelBlocks : undefined,
    }
    const { publicBaseUrl, appBaseUrl, apiBaseUrl, turnstileSiteKey } = getShareConfig()
    const html = renderShareHtml(view, { shareBaseUrl: publicBaseUrl, appBaseUrl, apiBaseUrl, turnstileSiteKey })
    const png = await renderShareImage(view)
    // Same bytes under both keys; the page's canonical/og URLs always point at the slug.
    for (const key of [letter.shareSlug, letter.id]) {
      await putObject(htmlKey(key), html, 'text/html; charset=utf-8')
      await putObject(imageKey(key), png, 'image/png')
    }
  } catch (err) {
    console.error('[share] sync failed for letter', letterId, err)
  }
}

/** Remove a letter's share objects (idempotent). Never throws. */
export async function removeShareForLetter(letterId: number): Promise<void> {
  try {
    if (!isConfigured()) return
    // The slug lives on the row, so read it before deleting. When the row is already gone
    // (delete-then-remove ordering) fall back to the legacy id keys only — the slug object
    // would otherwise be unreachable, which is why deletion reads the row first.
    const row = await lettersRepo.getById(letterId)
    const keys: (string | number)[] = row?.shareSlug ? [row.shareSlug, letterId] : [letterId]
    for (const key of keys) {
      await deleteObject(htmlKey(key))
      await deleteObject(imageKey(key))
    }
  } catch (err) {
    console.error('[share] remove failed for letter', letterId, err)
  }
}

/** Rebuild the share objects for every published letter. Returns how many were processed.
 *  Each letter is a per-letter no-op when R2 is unconfigured or publicSharePages is off. */
export async function regenerateAllShares(): Promise<number> {
  const published = await lettersRepo.listPublished()
  for (const l of published) await syncShareForLetter(l.id)
  return published.length
}

const RENDERER_VERSION_FLAG = 'shareRendererVersion'

/**
 * Regenerate every share page when the renderer's output has changed since the last run.
 *
 * Share pages are static R2 objects: a renderer change silently leaves every existing page
 * stale until an admin remembers to click "Regenerate share pages". This closes that gap by
 * comparing SHARE_RENDERER_VERSION against the version stored in the feature-flags table and
 * regenerating once when they differ.
 *
 * Gated rather than unconditional because the service runs on a plan that spins down and
 * cold-boots often — regenerating on every wake would write R2 objects needlessly. When the
 * version matches, this costs one flag read. Never throws; boot must not depend on it.
 */
export async function syncSharesIfRendererChanged(): Promise<void> {
  try {
    if (!isConfigured()) return
    if (!(await flagsRepo.isEnabled('publicSharePages'))) return

    const flags = await flagsRepo.getAll()
    const stored = flags[RENDERER_VERSION_FLAG]?.value ?? null
    if (stored === String(SHARE_RENDERER_VERSION)) return

    const count = await regenerateAllShares()
    await flagsRepo.setFlag(RENDERER_VERSION_FLAG, true, String(SHARE_RENDERER_VERSION))
    console.log(`[share] renderer v${SHARE_RENDERER_VERSION} (was ${stored ?? 'none'}) — regenerated ${count} share pages`)
  } catch (err) {
    console.error('[share] renderer-version sync failed:', err)
  }
}
