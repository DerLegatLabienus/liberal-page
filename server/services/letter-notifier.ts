import { AuthRepository } from '../repositories/auth-repository'
import { LettersRepository } from '../repositories/letters-repository'
import { sendEmailsThrottled, type SendArgs } from './email'

const authRepo = new AuthRepository()
const lettersRepo = new LettersRepository()

const SITE_URL = process.env.PUBLIC_SITE_URL ?? 'http://localhost:5173'

/**
 * Called each poller cycle. Finds all pinned letters with no notification sent yet,
 * emails every member who has emailAlerts=true, then stamps pin_notified_at.
 * Letters are bundled into one notification per user.
 */
export async function notifyPinnedLetters(): Promise<void> {
  const unnotified = await lettersRepo.listUnnotifiedPinned()
  if (unnotified.length === 0) return

  const members = await authRepo.listMembersForAlerts()
  if (members.length > 0) {
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

    await sendEmailsThrottled(messages)
  }

  await lettersRepo.markPinNotified(unnotified.map((l) => l.id))
}
