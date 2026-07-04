import { LettersRepository } from '../repositories/letters-repository'
import { LetterIssueTagsRepository } from '../repositories/letter-issue-tags-repository'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'
import { getShareConfig } from './share-config'
import { isConfigured, putObject, deleteObject } from './r2-client'
import { renderShareHtml, renderShareImage, type ShareLetterView } from './share-renderer'
import type { LetterAddress } from '../db/schema'

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

    const letter = await lettersRepo.getById(letterId)
    if (!letter || letter.status !== 'published') {
      await removeShareForLetter(letterId)
      return
    }

    const allTags = await tagsRepo.list()
    const tagIds = letter.issueTagIds as number[]
    const view: ShareLetterView = {
      id: letter.id,
      title: letter.title,
      subject: letter.subject,
      bodyHtml: letter.bodyHtml,
      bodyPlain: letter.bodyPlain,
      recipientNames: (letter.toAddresses as LetterAddress[]).map((a) => a.display_name),
      issueTags: allTags.filter((t) => tagIds.includes(t.id)).map((t) => t.name),
      toAddresses: letter.toAddresses as LetterAddress[],
      ccAddresses: letter.ccAddresses as LetterAddress[],
      bccAddresses: letter.bccAddresses as LetterAddress[],
    }
    const { publicBaseUrl, appBaseUrl, apiBaseUrl } = getShareConfig()
    const html = renderShareHtml(view, { shareBaseUrl: publicBaseUrl, appBaseUrl, apiBaseUrl })
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
