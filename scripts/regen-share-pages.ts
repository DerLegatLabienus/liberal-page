import { LettersRepository } from './server/repositories/letters-repository'
import { syncShareForLetter } from './server/services/share-publisher'
import { stripHtml } from './server/services/letter-utils'
import { isConfigured } from './server/services/r2-client'

const repo = new LettersRepository()

async function main() {
  if (!isConfigured()) { console.error('R2 not configured — pass R2_* env inline'); process.exit(1) }

  if (process.argv.includes('--create')) {
    const bodyHtml =
      '<p dir="rtl">לכבוד חבר הכנסת,</p>' +
      '<p dir="rtl">זהו מכתב בדיקה לצורך בדיקת מנגנון השיתוף הציבורי. נא להתעלם ממנו.</p>' +
      '<p dir="rtl">בברכה,<br>הליברלים בליכוד</p>'
    const letter = await repo.create({
      title: 'מכתב בדיקה — שיתוף ציבורי (למחיקה)',
      subject: 'בדיקת מנגנון שיתוף מכתבים',
      bodyHtml,
      bodyPlain: stripHtml(bodyHtml),
      toAddresses: [{ email: 'avivavitan63@gmail.com', display_name: 'ח"כ בדיקה' }],
      ccAddresses: [],
      bccAddresses: [],
      issueTagIds: [],
      templateId: null,
      status: 'published',
      priority: 'normal',
    } as Parameters<typeof repo.create>[0])
    console.log('created test letter #' + letter.id + ' — ' + letter.title)
  }

  const all = await repo.listAll()
  const published = all.filter((l) => l.status === 'published')
  console.log('regenerating share pages for ' + published.length + ' published letters...')
  for (const l of published) {
    await syncShareForLetter(l.id)
    console.log('  ✓ #' + l.id + ' ' + l.title)
  }
  console.log('done.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
