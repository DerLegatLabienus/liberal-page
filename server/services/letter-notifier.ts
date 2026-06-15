import { AuthRepository } from '../repositories/auth-repository'
import { LettersRepository } from '../repositories/letters-repository'
import { sendEmailsBatch, type SendArgs } from './email'

const authRepo = new AuthRepository()
const lettersRepo = new LettersRepository()

const SITE_URL = process.env.PUBLIC_SITE_URL ?? 'http://localhost:5173'

/**
 * Called each poller cycle. Finds all pinned letters with no notification sent yet,
 * emails every alert recipient (one batch request), then stamps pin_notified_at ONLY when at
 * least one email actually went out. Previously it stamped unconditionally — so a cycle with no
 * recipients or with email unconfigured silently marked the letters "notified" and they were
 * never retried (the cause of pinned-letter emails never arriving). Now it leaves them
 * unnotified to retry next cycle once email is configured / recipients exist.
 */
export async function notifyPinnedLetters(): Promise<void> {
  const unnotified = await lettersRepo.listUnnotifiedPinned()
  if (unnotified.length === 0) return

  const members = await authRepo.listMembersForAlerts()
  if (members.length === 0) {
    console.warn('[letter-notifier] %d pinned letter(s) to notify but no alert recipients — will retry', unnotified.length)
    return
  }

  const lettersList = unnotified
    .map((l) => `<li><a href="${SITE_URL}/letters/${l.id}">${l.title}</a></li>`)
    .join('')
  const lettersHtml = `<ul>${lettersList}</ul>`

  const messages: SendArgs[] = members.map((m) => ({
    to: m.email,
    template: 'letter_pin',
    params: { name: m.name ?? '', lettersList: lettersHtml },
    raw: ['lettersList'],
  }))

  const outcome = await sendEmailsBatch(messages)
  if (outcome.sent === 0) {
    console.warn('[letter-notifier] no emails sent (skipped=%d failed=%d) — leaving %d letter(s) unnotified to retry',
      outcome.skipped, outcome.failed, unnotified.length)
    return
  }

  await lettersRepo.markPinNotified(unnotified.map((l) => l.id))
  console.info('[letter-notifier] notified %d recipient(s) of %d pinned letter(s)', outcome.sent, unnotified.length)
}
