import { inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { letterContacts } from '../db/schema'
import { LettersRepository, attachChannels } from '../repositories/letters-repository'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { buildChannelSends } from './channel-send'
import { getShareConfig } from './share-config'
import { isConfigured, putObject, deleteObject } from './r2-client'
import { renderShareHtml, renderShareImage, type ShareLetterView, type ShareChannelBlock } from './share-renderer'

const lettersRepo = new LettersRepository()
const tagsRepo = new LetterIssueTagsRepository()
const flagsRepo = new FeatureFlagsRepository()

const htmlKey = (id: number) => `letter/${id}.html`
const imageKey = (id: number) => `letter/${id}.png`

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
    let emailNames: string[] = []
    if (emailChannel && emailChannel.recipientIds.length) {
      const rows = await db
        .select({ displayName: letterContacts.displayName })
        .from(letterContacts)
        .where(inArray(letterContacts.id, emailChannel.recipientIds))
      emailNames = rows.map((r) => r.displayName)
    }

    const channelBlocks: ShareChannelBlock[] = sends
      .filter((s) => s.enabled && (s.kind === 'sms' || s.kind === 'whatsapp'))
      .map((s) => ({
        kind: s.kind as 'sms' | 'whatsapp',
        recipients: (s.recipients ?? []).map((r) => ({ contactId: r.contactId, displayName: r.displayName, url: r.url })),
      }))
      .filter((b) => b.recipients.length > 0)

    const channelNames = channelBlocks.flatMap((b) => b.recipients.map((r) => r.displayName))
    const recipientNames = [...new Set([...emailNames, ...channelNames])]

    const allTags = await tagsRepo.list()
    const tagIds = letter.issueTagIds
    const view: ShareLetterView = {
      id: letter.id,
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
    await putObject(htmlKey(letter.id), html, 'text/html; charset=utf-8')
    await putObject(imageKey(letter.id), png, 'image/png')
  } catch (err) {
    console.error('[share] sync failed for letter', letterId, err)
  }
}

/** Remove a letter's share objects (idempotent). Never throws. */
export async function removeShareForLetter(letterId: number): Promise<void> {
  try {
    if (!isConfigured()) return
    await deleteObject(htmlKey(letterId))
    await deleteObject(imageKey(letterId))
  } catch (err) {
    console.error('[share] remove failed for letter', letterId, err)
  }
}
